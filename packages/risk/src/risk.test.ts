import { describe, expect, test } from "vitest";

import { observe } from "@crest/domain";
import type { ReasonCode } from "@crest/domain";

import { assessPosition, parseScenarioSet, planGuardianAction, RISK_ENGINE_VERSION, selectRepayment } from "./index.ts";
import type { RiskAssessment, RiskInput, ScenarioResult } from "./index.ts";
import { at, BLOCK, fixture, policyWith, scenarioSet } from "./test-fixtures.ts";
import type { FixtureOptions } from "./test-fixtures.ts";

// Synthetic exact price: 10 AAPL at 300 USDG is 3,000 USDG of collateral, so policy thresholds are exact debts.
// lower 30% = 900 USDG, target 35% = 1,050, upper 42% = 1,260, critical 50% = 1,500, Morpho LLTV 62.5% = 1,875.
const USDG = 1_000_000n;

function assess(options: FixtureOptions = {}): RiskAssessment {
  return assessPosition(fixture(options));
}

function withReasons<T>(observation: { value: T | null; provenance: typeof at }, reasons: ReasonCode[]) {
  return observe(observation.value, observation.provenance, reasons);
}

describe("LTV, health, and target debt", () => {
  test("no debt is a tagged state, never an infinite health", () => {
    const assessment = assess({ debtAssets: 0n, strategyQuotedAssets: 0n, costBasisAssets: 0n });
    expect(assessment.position).toMatchObject({
      ltvWad: null,
      morphoHealth: { kind: "no_debt" },
      policyHealth: { kind: "no_debt" },
      collateralValueAssets: 3_000n * USDG,
      targetDebtAssets: 1_050n * USDG,
      repayToTargetAssets: 0n,
    });
    expect(assessment.state).toBe("UPSIZE_AVAILABLE");
  });

  test("LTV rounds up, against the borrower", () => {
    expect(assess({ debtAssets: 1_000n * USDG }).position?.ltvWad).toBe(333_333_333_333_333_334n);
  });

  test("exactly at the lower threshold is inside the band; one unit below is upsize territory", () => {
    expect(assess({ debtAssets: 900n * USDG }).state).toBe("NORMAL");
    expect(assess({ debtAssets: 900n * USDG - 1n }).state).toBe("UPSIZE_AVAILABLE");
  });

  test("exactly at the upper threshold is not yet protection; one unit above is", () => {
    expect(assess({ debtAssets: 1_260n * USDG }).state).toBe("NORMAL");
    expect(assess({ debtAssets: 1_260n * USDG + 1n }).state).toBe("PROTECT");
  });

  test("exactly at the critical threshold is critical; one unit below is protection", () => {
    const critical = assess({ debtAssets: 1_500n * USDG });
    expect(critical.state).toBe("CRITICAL");
    expect(critical.position?.policyHealth).toEqual({ kind: "finite", wad: 10n ** 18n });
    expect(assess({ debtAssets: 1_500n * USDG - 1n }).state).toBe("PROTECT");
  });

  test("Morpho health is exactly one at the market LLTV and uses Morpho's own rounding", () => {
    expect(assess({ debtAssets: 1_875n * USDG }).position?.morphoHealth).toEqual({ kind: "finite", wad: 10n ** 18n });
    expect(assess({ debtAssets: 1_875n * USDG + 1n }).position?.morphoHealth).toEqual({ kind: "finite", wad: 999_999_999_466_666_666n });
  });

  test("repayment to target is the exact excess over target debt", () => {
    expect(assess({ debtAssets: 1_260n * USDG + 1n }).position?.repayToTargetAssets).toBe(210n * USDG + 1n);
  });

  test("collateral with no value and outstanding debt is critical, not a division error", () => {
    const assessment = assess({ debtAssets: USDG, oraclePrice: 0n, collateralAnswer: 0n });
    expect(assessment.state).toBe("CRITICAL");
    expect(assessment.position?.ltvWad).toBeNull();
    expect(assessment.position?.morphoHealth).toEqual({ kind: "finite", wad: 0n });
  });
});

describe("oracle security gate", () => {
  // The reviewed market's recorded oracle state: price() is the feed ratio times uiMultiplier.
  const recorded = {
    oraclePrice: 333_702_483_330_720_726_732_405_916n,
    collateralAnswer: 33_348_367_165n,
    loanAnswer: 99_991_000n,
    multiplierWad: 1_000_566_080_061_092_436n,
  };

  test("capacity uses Morpho's value, while Crest's feed-only value and the explained gap are disclosed", () => {
    const { position, reasons } = assess({ ...recorded, debtAssets: 1_000n * USDG });
    expect(position?.oracle.composition).toBe("feed_times_multiplier");
    expect(position?.collateralValueAssets).toBe(3_337_024_833n);
    expect(position?.feedOnlyCollateralValueAssets).toBe(3_335_136_878n);
    // The gap is the multiplier itself, 0.0566%, rounded up so the gate trips first: exactly uiMultiplier - 1.
    expect(position?.oracle.divergenceWad).toBe(566_080_061_092_436n);
    expect(reasons).not.toContain("oracle_divergence");
  });

  test("a gap wider than policy allows stops new borrowing and freezes", () => {
    const assessment = assessPosition(fixture({ ...recorded, debtAssets: 600n * USDG, policy: policyWith({ maxOracleDivergenceBps: "5" }) }));
    expect(assessment.reasons).toContain("oracle_divergence");
    expect(assessment.state).toBe("DEGRADED");
    expect(assessment.ownerBorrow.capacityAssets).toBe(0n);
    expect(assessment.freezeRequired).toBe(true);
  });

  test("a stock split would double a double-applied oracle; the gate catches it", () => {
    const split = assess({ oraclePrice: 600n * 10n ** 24n, multiplierWad: 2n * 10n ** 18n, debtAssets: 600n * USDG });
    expect(split.position?.oracle.composition).toBe("feed_times_multiplier");
    expect(split.reasons).toContain("oracle_divergence");
    expect(split.ownerBorrow.capacityAssets).toBe(0n);
  });

  test("an oracle price no known composition explains is a divergence even inside the bound", () => {
    const odd = assess({ oraclePrice: 300n * 10n ** 24n + 10n ** 21n, debtAssets: 600n * USDG, policy: policyWith({ maxOracleDivergenceBps: "100" }) });
    expect(odd.position?.oracle.composition).toBe("unexplained");
    expect(odd.reasons).toContain("oracle_divergence");
  });
});

describe("owner-borrow capacity", () => {
  test("is the smallest of debt ceiling, target LTV, Morpho liquidity, strategy cap, and vault deposit room", () => {
    const { ownerBorrow, state, ownerRecommendation } = assess({ debtAssets: 600n * USDG });
    // Morpho rounds minted borrow shares up, so a borrow of x can raise debt by x + 1: one unit is held back.
    expect(ownerBorrow.limits).toMatchObject({
      debtCeilingAssets: 900n * USDG - 1n,
      targetLtvAssets: 450n * USDG - 1n,
      marketLiquidityAssets: 238_958_227_292n,
      strategyCapAssets: 500n * USDG,
    });
    expect(ownerBorrow.capacityAssets).toBe(450n * USDG - 1n);
    expect(state).toBe("UPSIZE_AVAILABLE");
    expect(ownerRecommendation).toEqual({ kind: "owner_borrow", assets: 450n * USDG - 1n });
  });

  test("the borrow rounding reserve is one borrow share's value, however expensive shares become", () => {
    // The review's market: 1,364,023,701 assets over 196,242,494 shares is about 6.9 assets per share, so a borrow
    // can overshoot by up to 7 units. The reserve is ceil((A + 1) / (S + 1e6)) = 7.
    const input = fixture({ debtAssets: 600n * USDG });
    const market = input.market.value!;
    const accrued = { ...market.accrued, totalBorrowAssets: 1_364_023_701n, totalBorrowShares: 196_242_494n };
    const assessment = assessPosition({ ...input, market: observe({ ...market, accrued }, at) });
    expect(assessment.ownerBorrow.limits).toMatchObject({ debtCeilingAssets: 900n * USDG - 7n, targetLtvAssets: 450n * USDG - 7n });
  });

  test("is zero while the strategy cannot currently exit what it already holds", () => {
    const assessment = assess({ debtAssets: 600n * USDG, strategyAvailableAssets: 0n });
    expect(assessment.ownerBorrow).toMatchObject({ capacityAssets: 0n, blockers: ["degraded_input"] });
    expect(assessment.degradedSources).toEqual(["strategy"]);
    expect(assessment.state).toBe("DEGRADED");
    expect(assessment.freezeRequired).toBe(true);
    expect(assessment.ownerRecommendation.kind).toBe("owner_review");
  });

  test("is zero while borrowing is frozen, and the position is not advertised as upsizable", () => {
    const assessment = assess({ debtAssets: 600n * USDG, frozen: true });
    expect(assessment.ownerBorrow).toMatchObject({ capacityAssets: 0n, blockers: ["borrowing_frozen"] });
    expect(assessment.state).toBe("NORMAL");
  });

  test("is zero when the net spread for a new unit is below the policy minimum", () => {
    // 1.00% vault vs 0.574% borrow = 42 bps, under the 100 bps minimum.
    const assessment = assess({ debtAssets: 600n * USDG, vaultApy: "0.01" });
    expect(assessment.ownerBorrow.blockers).toEqual(["spread_below_minimum"]);
    expect(assessment.ownerBorrow.capacityAssets).toBe(0n);
  });

  test("is zero when rates cannot be netted, without freezing or degrading the position", () => {
    const input = fixture({ debtAssets: 600n * USDG });
    const assessment = assessPosition({ ...input, rates: { ...input.rates, borrow: withReasons(input.rates.borrow, ["stale"]) } });
    expect(assessment.ownerBorrow.blockers).toEqual(["rates_unavailable"]);
    expect(assessment.state).toBe("NORMAL");
    expect(assessment.freezeRequired).toBe(false);
  });

  test("an account the Guardian never borrows for: no planned action ever creates debt", () => {
    const debts = [0n, 600n, 900n, 1_000n, 1_261n, 1_500n, 1_900n].map((units) => units * USDG);
    for (const debtAssets of debts) {
      for (const frozen of [true, false]) {
        const action = planGuardianAction(assess({ debtAssets, frozen }));
        expect(action === null || ["freeze", "repay_reserve", "repay_strategy"].includes(action.kind)).toBe(true);
      }
    }
  });
});

describe("Guardian repayment bounds", () => {
  test("an unfrozen account above the upper band is frozen first", () => {
    expect(planGuardianAction(assess({ debtAssets: 1_300n * USDG }))).toEqual({ kind: "freeze", selector: "freezeBorrowing()" });
  });

  test("once frozen, protection repays exactly the excess over target from the larger source", () => {
    const assessment = assess({ debtAssets: 1_300n * USDG, frozen: true });
    expect(assessment.repayment).toMatchObject({ needAssets: 250n * USDG, reserveCapacityAssets: 10n * USDG, strategyCapacityAssets: 500n * USDG });
    expect(planGuardianAction(assessment)).toEqual({ kind: "repay_strategy", selector: "repayFromStrategy(uint256)", requestedAssets: 250n * USDG });
  });

  test("the per-action cap bounds a critical repayment", () => {
    const action = planGuardianAction(assess({ debtAssets: 1_600n * USDG, frozen: true }));
    expect(action).toEqual({ kind: "repay_strategy", selector: "repayFromStrategy(uint256)", requestedAssets: 500n * USDG });
  });

  test("only currently withdrawable vault assets count, never the quoted share value", () => {
    const assessment = assess({ debtAssets: 1_300n * USDG, frozen: true, strategyAvailableAssets: 120n * USDG });
    expect(assessment.repayment.strategyCapacityAssets).toBe(120n * USDG);
    expect(planGuardianAction(assessment)).toMatchObject({ kind: "repay_strategy", requestedAssets: 120n * USDG });
  });

  test("the strategy floor is never withdrawn, with one share's value kept for rounding", () => {
    // The vault burns shares rounded up and the contract re-checks the floor on the rounded-down quote afterwards,
    // so the quote can fall by the withdrawal plus one share's value. On the reviewed vault one share is under a unit.
    const policy = policyWith({ strategyFloorAssets: "900000000" });
    const assessment = assess({ policy, debtAssets: 1_300n * USDG, frozen: true });
    expect(planGuardianAction(assessment)).toMatchObject({ kind: "repay_strategy", requestedAssets: 100n * USDG - 1n });

    // At about 5 assets per share the guard grows to ceil((5e9 + 1) / 1e9) = 6 units.
    const input = fixture({ policy, debtAssets: 1_300n * USDG, frozen: true });
    const pricey = observe({ ...input.vault.value!, totalAssets: 5_000_000_000n, totalSupply: 999_999_999n }, at);
    expect(assessPosition({ ...input, vault: pricey }).repayment.strategyCapacityAssets).toBe(100n * USDG - 6n);
  });

  test("idle reserve above its floor is used when it covers more", () => {
    const assessment = assess({ debtAssets: 1_300n * USDG, frozen: true, idleReserveAssets: 400n * USDG, strategyAvailableAssets: 100n * USDG });
    expect(assessment.repayment.reserveCapacityAssets).toBe(350n * USDG);
    expect(planGuardianAction(assessment)).toEqual({ kind: "repay_reserve", selector: "repayFromReserve(uint256)", requestedAssets: 250n * USDG });
  });

  test("equal source capacity prefers the idle reserve, which needs no vault withdrawal", () => {
    const assessment = assess({ debtAssets: 1_300n * USDG, frozen: true, idleReserveAssets: 150n * USDG, strategyAvailableAssets: 100n * USDG });
    expect(planGuardianAction(assessment)).toMatchObject({ kind: "repay_reserve", requestedAssets: 100n * USDG });
  });

  test("no repayment ever exceeds the debt", () => {
    const assessment = assess({ debtAssets: 50n * USDG, frozen: true, borrowApy: "0.07925257197505986" });
    expect(assessment.state).toBe("EXIT_YIELD");
    expect(planGuardianAction(assessment)).toMatchObject({ kind: "repay_strategy", requestedAssets: 50n * USDG });
  });

  test("nothing withdrawable means an owner alert, never a blind retry or a collateral sale", () => {
    const assessment = assess({ debtAssets: 1_300n * USDG, frozen: true, idleReserveAssets: 50n * USDG, strategyAvailableAssets: 0n });
    expect(planGuardianAction(assessment)).toBeNull();
    expect(assessment.reasons).toContain("withdrawal_constrained");
    expect(assessment.ownerRecommendation.kind).toBe("owner_review");
  });
});

describe("degraded input", () => {
  function staleFeed(options: FixtureOptions): RiskInput {
    const input = fixture(options);
    return { ...input, oracle: { ...input.oracle, collateralFeed: withReasons(input.oracle.collateralFeed, ["stale"]) } };
  }

  test("zeroes owner-borrow capacity but still plans debt reduction above the upper band", () => {
    const assessment = assessPosition(staleFeed({ debtAssets: 1_300n * USDG, frozen: true }));
    expect(assessment.ownerBorrow).toMatchObject({ capacityAssets: 0n });
    expect(assessment.ownerBorrow.blockers).toContain("degraded_input");
    expect(assessment.state).toBe("PROTECT");
    expect(planGuardianAction(assessment)).toMatchObject({ kind: "repay_strategy", requestedAssets: 250n * USDG });
  });

  test("inside the band it is DEGRADED: freeze, then no speculative repayment", () => {
    const unfrozen = assessPosition(staleFeed({ debtAssets: 600n * USDG }));
    expect(unfrozen.state).toBe("DEGRADED");
    expect(unfrozen.degradedSources).toEqual(["collateralFeed"]);
    expect(planGuardianAction(unfrozen)).toEqual({ kind: "freeze", selector: "freezeBorrowing()" });
    expect(planGuardianAction(assessPosition(staleFeed({ debtAssets: 600n * USDG, frozen: true })))).toBeNull();
  });

  test("an owner can choose not to freeze on a degraded source group; capacity stays zero", () => {
    const policy = policyWith({ triggers: { freezeOnOracleDegraded: false, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true } });
    const assessment = assessPosition(staleFeed({ policy, debtAssets: 600n * USDG }));
    expect(assessment.freezeRequired).toBe(false);
    expect(assessment.ownerBorrow.capacityAssets).toBe(0n);
    expect(planGuardianAction(assessment)).toBeNull();
  });

  test("the policy's own freshness budgets are re-applied, so a looser adapter budget cannot pass stale data", () => {
    const input = fixture({ debtAssets: 600n * USDG });
    const lagging = observe({ block: BLOCK, headLagSeconds: 500n }, at);
    const agedFeed = observe({ ...input.oracle.loanFeed.value!, ageSeconds: 90_000n }, at);
    expect(assessPosition({ ...input, head: lagging }).reasons).toContain("head_lag");
    expect(assessPosition({ ...input, oracle: { ...input.oracle, loanFeed: agedFeed } }).reasons).toContain("stale");
  });

  test("onchain inputs read at different blocks do not describe one state", () => {
    const input = fixture({ debtAssets: 600n * USDG });
    const elsewhere = observe(input.market.value, { kind: "onchain", chainId: 4663, block: { ...BLOCK, number: BLOCK.number - 1n, hash: `0x${"cd".repeat(32)}` } });
    const assessment = assessPosition({ ...input, market: elsewhere });
    expect(assessment.reasons).toContain("block_skew");
    expect(assessment.state).toBe("DEGRADED");
  });

  test("a repayment source that is skewed, stale, or drifted is not counted, so no request rests on it", () => {
    const input = fixture({ debtAssets: 1_300n * USDG, frozen: true, idleReserveAssets: 50n * USDG, strategyAvailableAssets: 120n * USDG });
    const elsewhere = observe(input.strategy.value, { kind: "onchain", chainId: 4663, block: { ...BLOCK, number: BLOCK.number - 1n, hash: `0x${"cd".repeat(32)}` } });
    for (const strategy of [elsewhere, withReasons(input.strategy, ["stale"]), withReasons(input.strategy, ["route_drift"])]) {
      const assessment = assessPosition({ ...input, strategy });
      expect(assessment.state).toBe("PROTECT");
      expect(assessment.repayment.strategyCapacityAssets).toBe(0n);
      expect(planGuardianAction(assessment)).toBeNull();
    }
    // Realized loss and constrained liquidity are facts about the source, not doubts about it: those still count.
    expect(assessPosition({ ...input, strategy: withReasons(input.strategy, ["vault_loss"]) }).repayment.strategyCapacityAssets).toBe(120n * USDG);
  });

  test("a position read for another account is not this account's risk", () => {
    const input = fixture({ debtAssets: 1_300n * USDG, frozen: true });
    const foreign = observe({ ...input.position.value!, account: `0x${"e5".repeat(20)}` as const }, at);
    const assessment = assessPosition({ ...input, position: foreign });
    expect(assessment.reasons).toContain("identity_mismatch");
    expect(assessment.position).toBeNull();
    expect(assessment.state).toBe("DEGRADED");
    expect(planGuardianAction(assessment)).toBeNull();
  });

  test("an onchain policy nonce that differs from the active policy invalidates the assessment", () => {
    const input = fixture({ debtAssets: 600n * USDG });
    const assessment = assessPosition({ ...input, policy: { ...input.policy, nonce: 2n } });
    expect(assessment.reasons).toContain("conflict");
    expect(assessment.state).toBe("DEGRADED");
  });

  test("under a superseded policy nothing is repaid, because its floors and caps may no longer hold", () => {
    const input = fixture({ debtAssets: 1_300n * USDG, frozen: true });
    const assessment = assessPosition({ ...input, policy: { ...input.policy, nonce: 2n } });
    expect(assessment.state).toBe("PROTECT");
    expect(assessment.repayment).toMatchObject({ reserveCapacityAssets: 0n, strategyCapacityAssets: 0n });
    expect(planGuardianAction(assessment)).toBeNull();
    expect(planGuardianAction(assessPosition({ ...fixture({ debtAssets: 1_300n * USDG }), policy: { ...input.policy, nonce: 2n } }))).toEqual({ kind: "freeze", selector: "freezeBorrowing()" });
  });
});

describe("exit yield and harvest", () => {
  test("realized vault loss exits yield instead of hiding behind DEGRADED", () => {
    const input = fixture({ debtAssets: 1_000n * USDG, frozen: true });
    const assessment = assessPosition({ ...input, vault: withReasons(input.vault, ["vault_loss"]), strategy: withReasons(input.strategy, ["vault_loss"]) });
    expect(assessment.state).toBe("EXIT_YIELD");
    expect(assessment.ownerRecommendation.kind).toBe("owner_review");
    expect(planGuardianAction(assessment)).toMatchObject({ kind: "repay_strategy", requestedAssets: 500n * USDG });
  });

  test("a negative marginal spread exits yield: freeze first, then repay from the strategy", () => {
    const inverted = { debtAssets: 1_000n * USDG, borrowApy: "0.07925257197505986" };
    expect(assess(inverted).state).toBe("EXIT_YIELD");
    expect(planGuardianAction(assess(inverted))).toEqual({ kind: "freeze", selector: "freezeBorrowing()" });
    expect(planGuardianAction(assess({ ...inverted, frozen: true }))).toMatchObject({ kind: "repay_strategy", requestedAssets: 500n * USDG });
  });

  test("a stale rate that still shows a negative spread keeps the exit: degraded evidence can only tighten", () => {
    const input = fixture({ debtAssets: 1_000n * USDG, borrowApy: "0.07925257197505986" });
    const assessment = assessPosition({ ...input, rates: { ...input.rates, borrow: withReasons(input.rates.borrow, ["stale"]) } });
    expect(assessment.state).toBe("EXIT_YIELD");
    expect(assessment.freezeRequired).toBe(true);
    expect(assessment.ownerBorrow.blockers).toContain("rates_unavailable");
  });

  test("a realized surplus above the threshold is harvested toward debt without freezing", () => {
    const assessment = assess({ debtAssets: 1_000n * USDG, strategyQuotedAssets: 1_030n * USDG });
    expect(assessment.state).toBe("HARVESTABLE");
    expect(assessment.freezeRequired).toBe(false);
    expect(planGuardianAction(assessment)).toEqual({ kind: "repay_strategy", selector: "repayFromStrategy(uint256)", requestedAssets: 30n * USDG });
  });

  test("projected carry never becomes a repayment: without a reconciled cost basis nothing is harvested", () => {
    const assessment = assess({ debtAssets: 1_000n * USDG, strategyQuotedAssets: 1_030n * USDG, costBasisAssets: null });
    expect(assessment.carry?.annualCarryAssets).toBeGreaterThan(0n);
    expect(assessment.state).toBe("NORMAL");
    expect(planGuardianAction(assessment)).toBeNull();
  });

  test("a surplus below the threshold is left alone", () => {
    expect(assess({ debtAssets: 1_000n * USDG, strategyQuotedAssets: 1_009n * USDG }).state).toBe("NORMAL");
  });
});

describe("determinism", () => {
  test("the same versioned input produces the same assessment, hash, and action", () => {
    const input = fixture({ debtAssets: 1_300n * USDG, frozen: true });
    const first = assessPosition(input);
    const second = assessPosition(structuredClone(input));
    expect(second).toEqual(first);
    expect(first.engineVersion).toBe(RISK_ENGINE_VERSION);
    expect(first.inputHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(planGuardianAction(second)).toEqual(planGuardianAction(first));
  });

  test("any input change changes the input hash", () => {
    expect(assess({ debtAssets: 1_300n * USDG }).inputHash).not.toBe(assess({ debtAssets: 1_300n * USDG + 1n }).inputHash);
  });

  test("the assessment names the policy version and scenario set it was computed under", () => {
    const input = fixture();
    expect(assessPosition(input)).toMatchObject({ policyNonce: 1n, policyHash: input.policy.compiled.policyHash, scenarioSetVersion: input.scenarios.version, block: BLOCK });
  });
});

describe("stress scenarios", () => {
  function scenario(assessment: RiskAssessment, id: string): ScenarioResult {
    const result = assessment.scenarios.find((entry) => entry.id === id);
    if (result === undefined) throw new Error(`no scenario ${id}`);
    return result;
  }

  test("every configured scenario runs, labelled illustrative, and none shows more capacity than the live position", () => {
    for (const debtAssets of [0n, 600n * USDG, 1_000n * USDG, 1_300n * USDG]) {
      const assessment = assess({ debtAssets });
      expect(assessment.scenarioSetStatus).toBe("illustrative");
      expect(assessment.scenarios.map((entry) => entry.id)).toEqual(scenarioSet.scenarios.map((entry) => entry.id));
      for (const entry of assessment.scenarios) expect(entry.ownerBorrow.capacityAssets).toBeLessThanOrEqual(assessment.ownerBorrow.capacityAssets);
    }
  });

  test("a position at target LTV turns PROTECT at a 20% drop and CRITICAL at 35%, with Morpho health recomputed", () => {
    const assessment = assess({ debtAssets: 1_050n * USDG });
    expect(assessment.state).toBe("NORMAL");
    expect(scenario(assessment, "aapl-price-down-20")).toMatchObject({
      state: "PROTECT",
      position: { collateralValueAssets: 2_400n * USDG, debtAssets: 1_050n * USDG, morphoHealth: { kind: "finite", wad: 1_428_571_428_571_428_571n } },
    });
    expect(scenario(assessment, "aapl-price-down-35")).toMatchObject({
      state: "CRITICAL",
      position: { collateralValueAssets: 1_950n * USDG, morphoHealth: { kind: "finite", wad: 1_160_714_285_714_285_714n } },
    });
  });

  test("the spread inversion removes all new borrowing and exits yield", () => {
    const inverted = scenario(assess({ debtAssets: 600n * USDG }), "borrow-rate-spike");
    expect(inverted.ownerBorrow).toMatchObject({ capacityAssets: 0n, blockers: ["spread_below_minimum"] });
    expect(inverted.carry?.marginalSpreadBps).toBeLessThan(0n);
    expect(inverted.state).toBe("EXIT_YIELD");
  });

  test("with vault exit liquidity gone, protection falls back to what the reserve covers and flags the shortfall", () => {
    const assessment = assess({ debtAssets: 1_300n * USDG, frozen: true });
    const dry = scenario(assessment, "vault-exit-dry");
    expect(dry.repayment).toMatchObject({ strategyAvailableAssets: 0n, strategyCapacityAssets: 0n, needAssets: 250n * USDG });
    expect(selectRepayment(dry.repayment)).toEqual({ source: "reserve", assets: 10n * USDG });
    expect(dry.reasons).toContain("withdrawal_constrained");
    expect(assessment.reasons).not.toContain("withdrawal_constrained");
  });

  test("a scenario that could loosen any bound is rejected before it runs", () => {
    const base = { schemaVersion: 2, version: "t", status: "illustrative", provenance: "test" };
    const one = (kind: string, shocks: Record<string, string>) => ({ ...base, scenarios: [{ id: "s", kind, label: "s", rationale: "s", shocks }] });
    expect(() => parseScenarioSet(one("collateral_drop", { collateralPriceBps: "500" }))).toThrow(/collateral shock/);
    expect(() => parseScenarioSet(one("spread_inversion", { borrowApyShiftBps: "-100" }))).toThrow(/borrow APY shock/);
    expect(() => parseScenarioSet(one("spread_inversion", { vaultApyShiftBps: "100" }))).toThrow(/vault APY shock/);
    expect(() => parseScenarioSet(one("vault_liquidity", { vaultLiquidityBps: "-10001" }))).toThrow(/liquidity shock/);
    expect(() => parseScenarioSet(one("vault_liquidity", { collateralPriceBps: "-100" }))).toThrow(/cannot carry collateralPriceBps/);
    expect(() => parseScenarioSet({ ...base, scenarios: [...one("collateral_drop", { collateralPriceBps: "-1" }).scenarios, ...one("collateral_drop", { collateralPriceBps: "-2" }).scenarios] })).toThrow(/duplicate scenario id/);
  });
});
