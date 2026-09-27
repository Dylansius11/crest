import { describe, expect, test } from "vitest";

import { observe, parseDecimalUnits } from "@crest/domain";
import type { Observation, Provenance, ReasonCode } from "@crest/domain";
import type { Incentive, RateValue, VaultFees } from "@crest/rates";

import { estimateCarry } from "./index.ts";
import type { CarryInput } from "./index.ts";

const WAD = 10n ** 18n;
const http: Provenance = { kind: "http", url: "https://api.morpho.org", fetchedAt: "2026-09-23T04:06:16Z", generatedAt: null, expiresAt: null, indexedBlock: 70214579n };
const onchain: Provenance = { kind: "onchain", chainId: 4663, block: { number: 70226651n, hash: `0x${"ab".repeat(32)}`, timestamp: 1_790_000_000n } };

function rate(kind: RateValue["kind"], decimal: string, window: RateValue["window"] = "P1D", reasons: ReasonCode[] = [], convention: RateValue["convention"] = "apy-compounded"): Observation<RateValue> {
  return observe<RateValue>({ kind, value: parseDecimalUnits(decimal, 18), scale: WAD, convention, window }, http, reasons);
}

// Recorded 2026-09-23: market 24h borrow APY and vault `lookback=one_day` native APY (packages/rates fixtures).
const BORROW = "0.0057406736830905025";
const VAULT = "0.039987695710272775";

function input(overrides: Partial<CarryInput> = {}): CarryInput {
  return {
    strategyAssets: 1_000_000_000n,
    debtAssets: 1_000_000_000n,
    borrowRate: rate("market_borrow", BORROW),
    vaultRate: rate("vault_native", VAULT),
    fees: observe<VaultFees>({ performanceFeeWad: 0n, managementFeeAprWad: 0n }, onchain),
    vaultIncentives: observe<Incentive[]>([], http),
    marketIncentives: observe<Incentive[]>([], http),
    ...overrides,
  };
}

describe("estimateCarry", () => {
  test("keeps every component a separate projected field, with Morpho collateral yield fixed at zero", () => {
    expect(estimateCarry(input())).toEqual({
      kind: "projected",
      status: "normal",
      reasons: [],
      window: "P1D",
      convention: "apy-compounded",
      strategyAssets: 1_000_000_000n,
      debtAssets: 1_000_000_000n,
      collateralYieldAssets: 0n,
      // floor(1e9 * 0.0399876957...) and ceil(1e9 * 0.0057406736...): the estimate rounds against the owner.
      vaultYieldAssets: 39_987_695n,
      borrowCostAssets: 5_740_674n,
      feeAssets: 0n,
      incentiveAssets: 0n,
      annualCarryAssets: 34_247_021n,
      spreadBps: 342n,
      marginalSpreadBps: 342n,
    });
  });

  test("rates over different windows are never netted", () => {
    const estimate = estimateCarry(input({ vaultRate: rate("vault_native", VAULT, "PT6H") }));
    expect(estimate).toMatchObject({ status: "unknown", vaultYieldAssets: null, annualCarryAssets: null, spreadBps: null, marginalSpreadBps: null });
    expect(estimate.reasons).toContain("window_mismatch");
  });

  test("an instant simple APR is never netted against a compounded APY", () => {
    const estimate = estimateCarry(input({ borrowRate: rate("market_borrow", BORROW, "P1D", [], "apr-simple") }));
    expect(estimate.reasons).toContain("convention_mismatch");
    expect(estimate.annualCarryAssets).toBeNull();
  });

  test("a rate passed in the wrong role is rejected, not silently swapped", () => {
    expect(estimateCarry(input({ borrowRate: rate("vault_native", BORROW) })).reasons).toContain("identity_mismatch");
  });

  test("a stale rate still yields its numbers, labelled degraded", () => {
    const estimate = estimateCarry(input({ borrowRate: rate("market_borrow", BORROW, "P1D", ["stale"]) }));
    expect(estimate.status).toBe("degraded");
    expect(estimate.reasons).toEqual(["stale"]);
    expect(estimate.annualCarryAssets).toBe(34_247_021n);
  });

  test("vault fees are subtracted even if the provider APY is already net, so the estimate can only understate", () => {
    const fees = observe<VaultFees>({ performanceFeeWad: WAD / 10n, managementFeeAprWad: WAD / 100n }, onchain);
    const estimate = estimateCarry(input({ fees }));
    // ceil(39_987_695 * 10%) + ceil(1e9 * 1%) = 3_998_770 + 10_000_000
    expect(estimate.feeAssets).toBe(13_998_770n);
    expect(estimate.annualCarryAssets).toBe(39_987_695n - 5_740_674n - 13_998_770n);
    expect(estimate.marginalSpreadBps).toBe(202n);
  });

  test("incentives are their own field and never enter the marginal spread used to gate borrowing", () => {
    const reward: Incentive = { token: `0x${"1".repeat(40)}`, symbol: "MORPHO", side: "supply", aprWad: WAD / 50n, convention: "apr-simple" };
    const estimate = estimateCarry(input({ vaultIncentives: observe<Incentive[]>([reward], http) }));
    expect(estimate.incentiveAssets).toBe(20_000_000n);
    expect(estimate.annualCarryAssets).toBe(34_247_021n + 20_000_000n);
    expect(estimate.marginalSpreadBps).toBe(342n);
  });

  test("unknown incentives are reported unknown and add nothing", () => {
    const estimate = estimateCarry(input({ marketIncentives: observe<Incentive[]>(null, http) }));
    expect(estimate.incentiveAssets).toBeNull();
    expect(estimate.annualCarryAssets).toBe(34_247_021n);
    expect(estimate.status).toBe("normal");
  });

  test("a negative spread rounds toward the more negative basis point", () => {
    const estimate = estimateCarry(input({ borrowRate: rate("market_borrow", "0.07925257197505986") }));
    // 0.0399876957 - 0.0792525719 = -392.6 bps
    expect(estimate.marginalSpreadBps).toBe(-393n);
  });
});

describe("small denominators", () => {
  test("a dust strategy balance cannot turn a real dollar cost into an unexplained percentage", () => {
    const estimate = estimateCarry(input({ strategyAssets: 1n }));
    // The ratio is absurd, so the absolute stablecoin numerator and its denominator always travel with it.
    expect(estimate.spreadBps).toBeLessThan(-50_000_000n);
    expect(estimate.annualCarryAssets).toBe(0n - 5_740_674n);
    expect(estimate.strategyAssets).toBe(1n);
    expect(estimate.debtAssets).toBe(1_000_000_000n);
  });

  test("with nothing deployed there is no spread at all, only the absolute cost of the debt", () => {
    const estimate = estimateCarry(input({ strategyAssets: 0n }));
    expect(estimate.spreadBps).toBeNull();
    expect(estimate.borrowCostAssets).toBe(5_740_674n);
    expect(estimate.annualCarryAssets).toBe(-5_740_674n);
    expect(estimate.marginalSpreadBps).toBe(342n);
  });
});
