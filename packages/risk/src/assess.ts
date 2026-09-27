import { keccak256, stringToHex, zeroAddress } from "viem";
import type { Hex } from "viem";

import { canonicalJson, observe } from "@crest/domain";
import type { BlockRef, DegradedTriggers, GuardianState, Observation, ReasonCode } from "@crest/domain";
import type { RateValue } from "@crest/rates";
import type { AllocationCap, VaultSnapshot } from "@crest/vault";

import { estimateCarry } from "./carry.ts";
import type { CarryEstimate } from "./carry.ts";
import { SOURCE_NAMES } from "./input.ts";
import type { RiskInput, SourceName } from "./input.ts";
import { BPS, ceilDiv, minOf, ORACLE_PRICE_SCALE, remaining, WAD } from "./math.ts";
import { selectRepayment } from "./plan.ts";
import type { ScenarioShocks, StressScenario } from "./scenarios.ts";
import { screenInput } from "./screen.ts";
import type { OracleView, Screened } from "./screen.ts";

/** Bumped whenever the same input could produce a different assessment. Persisted with every assessment. */
export const RISK_ENGINE_VERSION = "crest-risk/1";

/** Computed health: the domain `Health` shape with a plain bigint, since the engine derives it rather than parses it. */
export type Health = { kind: "no_debt" } | { kind: "finite"; wad: bigint };

/** Where current LTV sits against the owner's bands. `critical` includes collateral with no value and debt. */
export type LtvBand = "below" | "inside" | "above" | "critical";

export interface PositionView {
  collateralAssets: bigint;
  debtAssets: bigint;
  /** Morpho's own valuation: collateral times the market oracle price. Every LTV, health, and capacity uses it. */
  collateralValueAssets: bigint;
  /** Crest's feed-only valuation, shown beside Morpho's. Null when a feed is unusable. */
  feedOnlyCollateralValueAssets: bigint | null;
  /** Debt over Morpho's collateral value, rounded up. Null with no debt or no collateral value. */
  ltvWad: bigint | null;
  band: LtvBand;
  /** Morpho's liquidation distance at the market LLTV; below one is liquidatable. */
  morphoHealth: Health;
  /** The same distance at the owner's critical LTV. */
  policyHealth: Health;
  targetDebtAssets: bigint;
  repayToTargetAssets: bigint;
  oracle: OracleView;
}

export interface BorrowLimits {
  debtCeilingAssets: bigint;
  targetLtvAssets: bigint;
  marketLiquidityAssets: bigint;
  strategyCapAssets: bigint;
  /** Room every Vault V2 cap on the liquidity adapter's ids leaves for one deposit. */
  vaultDepositAssets: bigint;
}

/** Conditions that zero owner-borrow capacity whatever the limits say. */
export type BorrowBlocker = "borrowing_frozen" | "degraded_input" | "rates_unavailable" | "spread_below_minimum";

export interface OwnerBorrow {
  capacityAssets: bigint;
  /** Null when the position itself cannot be assessed. */
  limits: BorrowLimits | null;
  blockers: BorrowBlocker[];
}

export interface RepaymentBounds {
  purpose: "none" | "protect" | "exit_yield" | "harvest";
  needAssets: bigint;
  /** Idle reserve above its floor, bounded by the per-action cap and the debt. */
  reserveCapacityAssets: bigint;
  /** Vault assets withdrawable now: bounded by vault exit liquidity and gates, never the quoted share value. */
  strategyAvailableAssets: bigint;
  /** Withdrawable strategy assets above the floor, bounded by the per-action cap and the debt. */
  strategyCapacityAssets: bigint;
  /** Quoted strategy assets above the reconciled cost basis. Null until the cost basis is reconciled. */
  realizedSurplusAssets: bigint | null;
}

export type OwnerRecommendation =
  | { kind: "none" }
  | { kind: "owner_borrow"; assets: bigint }
  | { kind: "owner_review"; reasons: ReasonCode[] };

export interface Evaluation {
  state: GuardianState;
  reasons: ReasonCode[];
  position: PositionView | null;
  carry: CarryEstimate | null;
  ownerBorrow: OwnerBorrow;
  repayment: RepaymentBounds;
}

export interface ScenarioResult extends Evaluation {
  id: string;
  kind: StressScenario["kind"];
  label: string;
}

export interface RiskAssessment extends Evaluation {
  engineVersion: typeof RISK_ENGINE_VERSION;
  /** keccak256 of the canonical input and engine version: the assessment's reproducible identity. */
  inputHash: Hex;
  policyNonce: bigint;
  policyHash: Hex;
  scenarioSetVersion: string;
  scenarioSetStatus: RiskInput["scenarios"]["status"];
  block: BlockRef | null;
  borrowingFrozen: boolean | null;
  degradedSources: SourceName[];
  freezeRequired: boolean;
  ownerRecommendation: OwnerRecommendation;
  scenarios: ScenarioResult[];
}

/** Which policy trigger decides whether a degraded source freezes borrowing. Core sources always do. */
const FREEZE_TRIGGER: Record<SourceName, keyof DegradedTriggers | null> = {
  head: null,
  account: null,
  market: null,
  position: null,
  marketPrice: "freezeOnOracleDegraded",
  collateralFeed: "freezeOnOracleDegraded",
  loanFeed: "freezeOnOracleDegraded",
  vault: "freezeOnVaultDegraded",
  strategy: "freezeOnVaultDegraded",
  lifecycle: "freezeOnLifecycleDegraded",
};

/** Reasons a human must look at: the Guardian cannot resolve them by freezing or repaying. */
const REVIEW_REASONS: readonly ReasonCode[] = ["withdrawal_constrained", "vault_loss", "withdrawal_gated", "identity_mismatch", "route_drift"];

/** Scales an amount by an adverse scenario shock. Shocks are -10000 to 0 bps, so this only ever lowers it. */
function shocked(value: bigint, bps: bigint | undefined): bigint {
  return bps === undefined ? value : (value * (BPS + bps)) / BPS;
}

function shiftedRate(rate: Observation<RateValue>, bps: bigint | undefined): Observation<RateValue> {
  if (bps === undefined || rate.value === null) return rate;
  return observe({ ...rate.value, value: rate.value.value + (bps * rate.value.scale) / BPS }, rate.provenance, rate.reasons);
}

/** Vault V2 deposits allocate straight into the liquidity adapter, so every cap on its three ids bounds one. */
function capRoom(cap: AllocationCap, totalAssets: bigint): bigint {
  if (cap.absoluteCap === 0n) return 0n;
  const absolute = remaining(cap.absoluteCap, cap.allocation);
  // Relative caps are checked against total assets before the deposit lands (`firstTotalAssets`).
  return cap.relativeCapWad >= WAD ? absolute : minOf(absolute, remaining((totalAssets * cap.relativeCapWad) / WAD, cap.allocation));
}

function vaultDepositRoom(vault: VaultSnapshot | null): bigint {
  if (vault === null || vault.caps === null) return 0n;
  // Gate contracts cannot be evaluated offline, so a configured deposit gate admits nothing here.
  if (vault.gates.receiveShares !== zeroAddress || vault.gates.sendAssets !== zeroAddress) return 0n;
  return minOf(capRoom(vault.caps.adapter, vault.totalAssets), capRoom(vault.caps.collateral, vault.totalAssets), capRoom(vault.caps.market, vault.totalAssets));
}

function positionView(screened: Screened, shocks: ScenarioShocks): PositionView | null {
  const { input, oracle } = screened;
  const position = input.position.value;
  const price = input.oracle.marketPrice.value;
  const foreign = input.position.reasons.includes("identity_mismatch") || input.market.reasons.includes("identity_mismatch");
  if (position === null || price === null || foreign) return null;

  const { policy, route } = input.policy.compiled;
  const { collateralAssets, debtAssets } = position;
  const collateralValueAssets = (collateralAssets * shocked(price, shocks.collateralPriceBps)) / ORACLE_PRICE_SCALE;
  const feedOnlyPrice = oracle.feedOnlyPrice === null ? null : shocked(oracle.feedOnlyPrice, shocks.collateralPriceBps);
  // Largest debt a threshold allows, over actual debt. Morpho rounds both steps down, so this matches `_isHealthy`.
  const healthAt = (thresholdWad: bigint): Health =>
    debtAssets === 0n ? { kind: "no_debt" } : { kind: "finite", wad: (((collateralValueAssets * thresholdWad) / WAD) * WAD) / debtAssets };
  const ltvWad = debtAssets === 0n || collateralValueAssets === 0n ? null : ceilDiv(debtAssets * WAD, collateralValueAssets);
  const band: LtvBand = debtAssets === 0n
    ? "below"
    : ltvWad === null || ltvWad >= policy.criticalLtvWad
      ? "critical"
      : ltvWad > policy.upperLtvWad ? "above" : ltvWad < policy.lowerLtvWad ? "below" : "inside";
  const targetDebtAssets = (collateralValueAssets * policy.targetLtvWad) / WAD;

  return {
    collateralAssets,
    debtAssets,
    collateralValueAssets,
    feedOnlyCollateralValueAssets: feedOnlyPrice === null ? null : (collateralAssets * feedOnlyPrice) / ORACLE_PRICE_SCALE,
    ltvWad,
    band,
    morphoHealth: healthAt(route.market.lltv),
    policyHealth: healthAt(policy.criticalLtvWad),
    targetDebtAssets,
    repayToTargetAssets: remaining(debtAssets, targetDebtAssets),
    oracle,
  };
}

/**
 * One pass of the engine over screened input, optionally under one scenario's shocks.
 *
 * State precedence: a position that cannot be valued is DEGRADED; then CRITICAL, PROTECT, and EXIT_YIELD, which
 * all reduce debt and so stay available on degraded input; then DEGRADED; then HARVESTABLE and UPSIZE_AVAILABLE,
 * which both need trustworthy input.
 */
function evaluate(screened: Screened, degraded: boolean, shocks: ScenarioShocks): Evaluation {
  const { input } = screened;
  const { policy } = input.policy.compiled;
  const account = input.account.value;
  const strategy = input.strategy.value;
  const position = positionView(screened, shocks);
  const debtAssets = position?.debtAssets ?? 0n;

  const carry = position === null || strategy === null
    ? null
    : estimateCarry({
      strategyAssets: strategy.quotedAssets,
      debtAssets,
      borrowRate: shiftedRate(input.rates.borrow, shocks.borrowApyShiftBps),
      vaultRate: shiftedRate(input.rates.vault, shocks.vaultApyShiftBps),
      fees: input.rates.fees,
      vaultIncentives: input.rates.vaultIncentives,
      marketIncentives: input.rates.marketIncentives,
    });

  const strategyAvailableAssets = strategy === null ? 0n : shocked(strategy.availableAssets, shocks.vaultLiquidityBps);
  // A strategy that cannot exit what it holds is illiquid input. Screening flags the observed case; this catches a shock.
  const illiquid = strategy !== null && strategyAvailableAssets < strategy.quotedAssets;
  const unreliable = degraded || illiquid;

  // Morpho mints borrow shares rounded up, so borrowing x can raise debt by x + 1. One unit is held back from each
  // debt-denominated room, which keeps the contract's post-borrow ceiling check from reverting on rounding.
  const debtAfterRounding = debtAssets + 1n;
  const limits: BorrowLimits | null = position === null
    ? null
    : {
      debtCeilingAssets: remaining(policy.debtCeilingAssets, debtAfterRounding),
      targetLtvAssets: remaining(position.targetDebtAssets, debtAfterRounding),
      marketLiquidityAssets: input.market.value?.liquidityAssets ?? 0n,
      strategyCapAssets: strategy === null ? 0n : remaining(policy.maxStrategyAssets, strategy.quotedAssets),
      vaultDepositAssets: vaultDepositRoom(input.vault.value),
    };
  const blockers: BorrowBlocker[] = [];
  if (account?.borrowingFrozen === true) blockers.push("borrowing_frozen");
  if (unreliable || limits === null) blockers.push("degraded_input");
  if (carry !== null && (carry.status !== "normal" || carry.marginalSpreadBps === null)) blockers.push("rates_unavailable");
  else if (carry?.marginalSpreadBps != null && carry.marginalSpreadBps < policy.minimumNetSpreadBps) blockers.push("spread_below_minimum");
  const capacityAssets = limits === null || blockers.length > 0
    ? 0n
    : minOf(limits.debtCeilingAssets, limits.targetLtvAssets, limits.marketLiquidityAssets, limits.strategyCapAssets, limits.vaultDepositAssets);

  // A repayment request must rest on this account's own reads at the pinned block, under the policy the contract
  // holds now. Otherwise its floors and caps may no longer apply, and only a freeze is safe to plan.
  const coherent = (reasons: readonly ReasonCode[]) => !reasons.includes("identity_mismatch") && !reasons.includes("block_skew");
  const repayable = account !== null && account.policyNonce === input.policy.nonce && coherent(input.account.reasons) && coherent(input.position.reasons);
  const perAction = policy.maxRepayPerActionAssets;
  const reserveCapacityAssets = repayable ? minOf(remaining(account.idleReserveAssets, policy.reserveFloorAssets), perAction, debtAssets) : 0n;
  // The contract re-checks the floor on the quote after the vault burns shares rounded up, so one unit stays behind.
  const strategyFloorGuard = policy.strategyFloorAssets === 0n ? 0n : policy.strategyFloorAssets + 1n;
  const strategyCapacityAssets = repayable && strategy !== null && coherent(input.strategy.reasons) && coherent(input.vault.reasons)
    ? minOf(strategyAvailableAssets, remaining(strategy.quotedAssets, strategyFloorGuard), perAction, debtAssets)
    : 0n;
  const realizedSurplusAssets = strategy === null || input.strategyCostBasisAssets === null ? null : remaining(strategy.quotedAssets, input.strategyCostBasisAssets);

  const vaultLoss = input.vault.reasons.includes("vault_loss") || input.strategy.reasons.includes("vault_loss");
  // Stale but comparable rates still count here: exiting only reduces debt, so degraded evidence may tighten.
  const negativeCarry = carry?.marginalSpreadBps != null && carry.marginalSpreadBps < 0n;
  const exitYield = debtAssets > 0n && (strategy?.quotedAssets ?? 0n) > 0n && (vaultLoss || negativeCarry);
  const harvestable = debtAssets > 0n && realizedSurplusAssets !== null && minOf(realizedSurplusAssets, strategyCapacityAssets) >= policy.harvestThresholdAssets;
  const state: GuardianState = position === null
    ? "DEGRADED"
    : position.band === "critical"
      ? "CRITICAL"
      : position.band === "above"
        ? "PROTECT"
        : exitYield
          ? "EXIT_YIELD"
          : unreliable
            ? "DEGRADED"
            : harvestable ? "HARVESTABLE" : position.band === "below" && capacityAssets > 0n ? "UPSIZE_AVAILABLE" : "NORMAL";

  const [purpose, needAssets]: [RepaymentBounds["purpose"], bigint] = state === "CRITICAL" || state === "PROTECT"
    ? ["protect", position?.repayToTargetAssets ?? 0n]
    : state === "EXIT_YIELD"
      ? ["exit_yield", debtAssets]
      : state === "HARVESTABLE" ? ["harvest", realizedSurplusAssets ?? 0n] : ["none", 0n];
  const repayment: RepaymentBounds = { purpose, needAssets, reserveCapacityAssets, strategyAvailableAssets, strategyCapacityAssets, realizedSurplusAssets };

  // Debt reduction the sources cannot cover in one capped action is a normal bounded outcome, surfaced for review.
  const covered = selectRepayment(repayment)?.assets ?? 0n;
  const constrained = repayable && (purpose === "protect" || purpose === "exit_yield") && covered < minOf(needAssets, perAction);
  const reasons = [
    ...SOURCE_NAMES.flatMap((name) => screened.sources[name]),
    ...(carry?.reasons ?? []),
    ...(constrained || illiquid ? (["withdrawal_constrained"] as const) : []),
  ].filter((reason, index, all) => all.indexOf(reason) === index);

  return { state, reasons, position, carry, ownerBorrow: { capacityAssets, limits, blockers }, repayment };
}

/**
 * Assesses one Crest Account from one coherent set of observations.
 *
 * Pure and deterministic: no clock, network, or randomness, so the same versioned input always produces the same
 * assessment and the same `inputHash`. Scenarios reuse the same pass with adverse shocks, and their capacity is
 * additionally clamped to the unstressed capacity.
 */
export function assessPosition(input: RiskInput): RiskAssessment {
  const screened = screenInput(input);
  const { policy, policyHash } = input.policy.compiled;
  const degradedSources = SOURCE_NAMES.filter((name) => screened.sources[name].length > 0);
  const base = evaluate(screened, degradedSources.length > 0, {});

  const scenarios = input.scenarios.scenarios.map((scenario): ScenarioResult => {
    const stressed = evaluate(screened, degradedSources.length > 0, scenario.shocks);
    const capacityAssets = minOf(stressed.ownerBorrow.capacityAssets, base.ownerBorrow.capacityAssets);
    return { id: scenario.id, kind: scenario.kind, label: scenario.label, ...stressed, ownerBorrow: { ...stressed.ownerBorrow, capacityAssets } };
  });

  const debtReduction = base.state === "CRITICAL" || base.state === "PROTECT" || base.state === "EXIT_YIELD";
  const freezeRequired = debtReduction || degradedSources.some((name) => {
    const trigger = FREEZE_TRIGGER[name];
    return trigger === null || policy.triggers[trigger];
  });

  const review = base.reasons.filter((reason) => REVIEW_REASONS.includes(reason));
  const ownerRecommendation: OwnerRecommendation = review.length > 0
    ? { kind: "owner_review", reasons: review }
    : base.position?.band === "below" && base.ownerBorrow.capacityAssets > 0n
      ? { kind: "owner_borrow", assets: base.ownerBorrow.capacityAssets }
      : { kind: "none" };

  return {
    engineVersion: RISK_ENGINE_VERSION,
    inputHash: keccak256(stringToHex(canonicalJson({ engineVersion: RISK_ENGINE_VERSION, input }))),
    policyNonce: input.policy.nonce,
    policyHash,
    scenarioSetVersion: input.scenarios.version,
    scenarioSetStatus: input.scenarios.status,
    block: screened.block,
    borrowingFrozen: input.account.value?.borrowingFrozen ?? null,
    degradedSources,
    freezeRequired,
    ownerRecommendation,
    ...base,
    scenarios,
  };
}
