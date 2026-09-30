import { describe, expect, test } from "vitest";

import { validateGuardianAction } from "./validate.ts";
import type { GuardianState } from "./validate.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const guardian = "0x2222222222222222222222222222222222222222" as const;
const other = "0x3333333333333333333333333333333333333333" as const;
const policyHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const marketId = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
const vault = "0x4444444444444444444444444444444444444444" as const;

const state: GuardianState = {
  block: { number: 100n, hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", timestamp: 1_700_000_000n },
  account,
  guardian,
  policyNonce: 7n,
  policyHash,
  marketId,
  vault,
  debtAssets: 100n,
  reserveAssets: 80n,
  shares: 50n,
  strategyAssets: 70n,
  withdrawableAssets: 60n,
  frozen: false,
  reserveFloorAssets: 30n,
  strategyFloorAssets: 20n,
  maxRepayPerActionAssets: 40n,
};

const expected = { account, guardian, policyHash, marketId, vault };

describe("validateGuardianAction", () => {
  test("allows an unfrozen account with debt to freeze borrowing", () => {
    expect(validateGuardianAction({ actionKind: "freeze", requestedAssets: null, policyNonce: 7n }, state, expected)).toEqual({ kind: "freeze" });
  });

  test("caps reserve repayment by the requested amount and floor-safe capacity", () => {
    expect(validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 99n, policyNonce: 7n }, state, expected)).toEqual({
      kind: "repay_reserve",
      assets: 40n,
    });

    expect(validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 12n, policyNonce: 7n }, state, expected)).toEqual({
      kind: "repay_reserve",
      assets: 12n,
    });
  });

  test("caps strategy repayment by withdrawal liquidity and the saturating floor", () => {
    expect(
      validateGuardianAction(
        { actionKind: "repay_strategy", requestedAssets: 99n, policyNonce: 7n },
        { ...state, maxRepayPerActionAssets: 99n, withdrawableAssets: 15n },
        expected,
      ),
    ).toEqual({ kind: "repay_strategy", assets: 15n });

    expect(() =>
      validateGuardianAction(
        { actionKind: "repay_strategy", requestedAssets: 1n, policyNonce: 7n },
        { ...state, strategyAssets: 10n, strategyFloorAssets: 20n },
        expected,
      ),
    ).toThrow();
  });

  test("permits a protective freeze with no debt, but refuses a debtless repayment", () => {
    expect(validateGuardianAction({ actionKind: "freeze", requestedAssets: null, policyNonce: 7n },
      { ...state, debtAssets: 0n }, expected)).toEqual({ kind: "freeze" });
    expect(() => validateGuardianAction({ actionKind: "freeze", requestedAssets: null, policyNonce: 7n },
      { ...state, frozen: true }, expected)).toThrow();
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 7n },
      { ...state, debtAssets: 0n }, expected)).toThrow();
  });

  test("fails closed when liquidity or policy evidence is degraded", () => {
    expect(() =>
      validateGuardianAction(
        { actionKind: "repay_strategy", requestedAssets: 1n, policyNonce: 7n },
        { ...state, withdrawableAssets: 0n },
        expected,
      ),
    ).toThrow();
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 8n }, state, expected)).toThrow();
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 7n }, { ...state, policyHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" }, expected)).toThrow();
  });

  test("rejects monitor attempts to drift identity or request a non-Guardian action", () => {
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 7n }, { ...state, account: other }, expected)).toThrow();
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 7n }, { ...state, guardian: other }, expected)).toThrow();
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 7n }, { ...state, marketId: policyHash }, expected)).toThrow();
    expect(() => validateGuardianAction({ actionKind: "repay_reserve", requestedAssets: 1n, policyNonce: 7n }, { ...state, vault: other }, expected)).toThrow();
    expect(() =>
      validateGuardianAction({ actionKind: "borrow", requestedAssets: 1n, policyNonce: 7n } as never, state, expected),
    ).toThrow();
  });
});
