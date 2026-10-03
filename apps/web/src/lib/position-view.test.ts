import { describe, expect, test } from "vitest";

import type { RecordedPosition, RecordedRate } from "@/components/account/types";
import { bandView, capitalView, interventionView, percentFromBpsValue, repaymentView, spreadView } from "./position-view";

const pct = (points: number) => (BigInt(points) * 10n ** 16n).toString();
const LLTV = BigInt(pct(86));

type Snapshot = NonNullable<RecordedPosition["snapshot"]>;
const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  blockNumber: "100", blockHash: "0xaa", observedAt: "2026-10-02T00:00:00.000Z", owner: "0x1", guardian: "0x2", frozen: false,
  collateralAssets: "500000000000000000", debtAssets: "30000000", collateralValueAssets: "1000000000", ltvWad: pct(3), morphoHealthWad: null,
  lowerLtvWad: pct(5), targetLtvWad: pct(10), upperLtvWad: pct(20), criticalLtvWad: pct(40),
  reserveAssets: "0", vaultShares: "1", quotedVaultAssets: "10000000", withdrawableVaultAssets: "10000000",
  reserveFloorAssets: "0", strategyFloorAssets: "0", maxRepayPerActionAssets: "10000000",
  ...overrides,
});

const rate = (overrides: Partial<RecordedRate> = {}): RecordedRate => ({
  status: "normal", reasons: [], value: "50000000000000000", scale: "1000000000000000000", convention: "apy", window: "P1D",
  source: "https://api.morpho.org/x", observedAt: "2026-10-02T00:00:00.000Z", ...overrides,
});

describe("LTV band", () => {
  test("zone boundaries: the upper guard itself is in band, critical and LLTV are inclusive", () => {
    expect(bandView(snapshot({ ltvWad: pct(20) }), LLTV).zone).toBe("in-band");
    expect(bandView(snapshot({ ltvWad: pct(21) }), LLTV).zone).toBe("above-upper");
    expect(bandView(snapshot({ ltvWad: pct(40) }), LLTV).zone).toBe("critical");
    expect(bandView(snapshot({ ltvWad: pct(86) }), LLTV).zone).toBe("beyond-lltv");
    expect(bandView(snapshot({ ltvWad: pct(4) }), LLTV).zone).toBe("below-lower");
  });

  test("zero debt is its own state, and a missing valuation with debt is unavailable rather than zero", () => {
    expect(bandView(snapshot({ debtAssets: "0", ltvWad: null }), LLTV)).toMatchObject({ zone: "no-debt", currentAt: 0 });
    expect(bandView(snapshot({ ltvWad: null, collateralValueAssets: null }), LLTV)).toMatchObject({ zone: "unavailable", currentAt: null, borrowToTargetAssets: null, repayToTargetAssets: null });
  });

  test("distance to target: below target is owner-approval borrow room, above target is repayment", () => {
    // 1,000 loan units of collateral at a 10 % target allows 100 of debt.
    expect(bandView(snapshot({ debtAssets: "30000000", collateralValueAssets: "1000000000" }), LLTV)).toMatchObject({ borrowToTargetAssets: 70000000n, repayToTargetAssets: 0n });
    expect(bandView(snapshot({ debtAssets: "300000000", collateralValueAssets: "1000000000", ltvWad: pct(30) }), LLTV)).toMatchObject({ borrowToTargetAssets: 0n, repayToTargetAssets: 200000000n });
  });

  test("markers sit proportionally against the LLTV terminal and the current LTV never overflows it", () => {
    const view = bandView(snapshot({ ltvWad: pct(95) }), LLTV);
    expect(view.markers.find((marker) => marker.key === "critical")?.at).toBeCloseTo(46.51, 2);
    expect(view.currentAt).toBe(100);
  });
});

describe("carry spread", () => {
  test("prints a net spread only for two normal, comparable rates, and states an inversion", () => {
    expect(spreadView(rate({ value: "52000000000000000" }), rate({ value: "40000000000000000" }))).toEqual({ kind: "net", bps: -120n, inverted: true });
    expect(spreadView(rate({ value: "30000000000000000" }), rate({ value: "45000000000000000" }))).toEqual({ kind: "net", bps: 150n, inverted: false });
  });

  test("withholds the net value when a side is unread, degraded, or on a different window", () => {
    expect(spreadView(rate({ status: "unknown", reasons: ["unreadable"], value: null, scale: null }), rate())).toMatchObject({ kind: "withheld", reason: expect.stringContaining("unreadable") });
    expect(spreadView(rate(), rate({ status: "degraded", reasons: ["stale"] }))).toMatchObject({ kind: "withheld", reason: expect.stringContaining("stale") });
    expect(spreadView(rate(), rate({ window: "P7D" }))).toMatchObject({ kind: "withheld", reason: expect.stringContaining("not comparable") });
  });

  test("signed basis points keep their sign below one percent", () => {
    expect(percentFromBpsValue(-5n)).toBe("-0.05%");
    expect(percentFromBpsValue(1234n)).toBe("12.34%");
  });
});

describe("realized repayment", () => {
  const event = { debtBeforeAssets: "10000007", debtAfterAssets: "3325000", debtRepaidAssets: "6675007", blockNumber: "127438189", transactionHash: "0x13" };

  test("a canonical event whose debt fell is verified with the exact reduction", () => {
    expect(repaymentView(event, true)).toMatchObject({ kind: "verified", reduced: 6675007n });
  });

  test("a recorded event whose debt did not fall is a failed postcondition, never success", () => {
    expect(repaymentView({ ...event, debtAfterAssets: "10000007" }, true)).toMatchObject({ kind: "postcondition-failed", reduced: 0n });
  });

  test("an empty card states why it is empty", () => {
    expect(repaymentView(null, true)).toMatchObject({ kind: "empty", reason: expect.stringContaining("No canonical strategy repayment") });
    expect(repaymentView(null, false)).toMatchObject({ kind: "empty", reason: expect.stringContaining("No recorded position") });
  });
});

describe("Guardian intervention", () => {
  const base = { actionKind: "repay_strategy", requestedAssets: "6675007", status: "completed", reasonCodes: [], detectedAt: "2026-10-02T00:00:00.000Z", forCurrentAssessment: false };

  test("a completed run with any failed check is a failed postcondition, not verified", () => {
    const view = interventionView({ ...base, run: { status: "completed", failureClass: null, transactionHash: "0x1", checks: [{ kind: "debt_decreased", passed: true }, { kind: "strategy_floor_held", passed: false }] } });
    expect(view).toMatchObject({ outcome: "postcondition-failed", failedChecks: ["strategy_floor_held"], selector: "repayFromStrategy(uint256)" });
  });

  test("run state maps to outcome, and an unclaimed trigger is only detected", () => {
    expect(interventionView({ ...base, run: { status: "completed", failureClass: null, transactionHash: "0x1", checks: [{ kind: "debt_decreased", passed: true }] } })?.outcome).toBe("verified");
    expect(interventionView({ ...base, status: "failed", run: { status: "failed", failureClass: "pre_sign_validation_or_simulation", transactionHash: null, checks: [] } })?.outcome).toBe("failed");
    expect(interventionView({ ...base, status: "claimed", run: { status: "broadcast", failureClass: null, transactionHash: "0x1", checks: [] } })?.outcome).toBe("pending");
    expect(interventionView({ ...base, actionKind: "freeze", requestedAssets: null, status: "detected", run: null })).toMatchObject({ outcome: "detected", selector: "freezeBorrowing()" });
  });
});

describe("capital allocation", () => {
  test("floor reached only when debt exists and both repayment sources sit at their floors", () => {
    const atFloor = snapshot({ reserveAssets: "1000000", reserveFloorAssets: "1000000", withdrawableVaultAssets: "2000000", strategyFloorAssets: "2000000" });
    expect(capitalView(atFloor, null).floorReached).toBe(true);
    expect(capitalView({ ...atFloor, debtAssets: "0" }, null).floorReached).toBe(false);
    expect(capitalView({ ...atFloor, withdrawableVaultAssets: "2000001" }, null).floorReached).toBe(false);
  });

  test("withdrawable below quoted is a constraint, and the engine's capacity is passed through untouched", () => {
    const view = capitalView(snapshot({ quotedVaultAssets: "650000", withdrawableVaultAssets: "400000" }), {
      status: "PROTECT", createdAt: "", reasonCodes: ["vault_loss"], recommendedAction: "repay_strategy", policyHealthWad: null,
      ownerBorrowCapacityAssets: "0", repayCapacityAssets: "400000", projectedCarryAssets: null, projectedSpreadBps: null,
      rates: { borrow: rate(), vault: rate() }, provenance: [],
    });
    expect(view).toMatchObject({ constrained: true, vaultLoss: true, actionableAssets: 400000n });
  });
});
