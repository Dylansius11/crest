import { describe, expect, test } from "vitest";

import { verifyGuardianPostconditions } from "./postconditions.ts";
import type { GuardianState } from "./validate.ts";
const account = "0x1111111111111111111111111111111111111111" as const;
const guardian = "0x2222222222222222222222222222222222222222" as const;
const other = "0x3333333333333333333333333333333333333333" as const;

const before: GuardianState = {
  block: { number: 100n, hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", timestamp: 1_700_000_000n },
  account,
  guardian,
  policyNonce: 7n,
  policyHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  marketId: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  vault: "0x4444444444444444444444444444444444444444",
  debtAssets: 100n,
  reserveAssets: 30n,
  shares: 50n,
  strategyAssets: 80n,
  withdrawableAssets: 60n,
  frozen: false,
  reserveFloorAssets: 20n,
  strategyFloorAssets: 40n,
  maxRepayPerActionAssets: 40n,
};

describe("verifyGuardianPostconditions", () => {
  test("requires a successful BorrowingFrozen event from the Guardian", () => {
    const checks = verifyGuardianPostconditions({
      action: { kind: "freeze" },
      before,
      after: { ...before, frozen: true },
      receipt: { success: true, crestEvent: { kind: "freeze", actor: guardian } },
    });

    expect(checks).toEqual([expect.objectContaining({ kind: "frozen", passed: true })]);

    const missingEventChecks = verifyGuardianPostconditions({
      action: { kind: "freeze" },
      before,
      after: { ...before, frozen: true },
      receipt: { success: true },
    });

    expect(missingEventChecks).toEqual([expect.objectContaining({ kind: "frozen", passed: false })]);
  });

  test("proves a successful strategy repayment with debt, floor, vault, and Morpho evidence", () => {
    const checks = verifyGuardianPostconditions({
      action: { kind: "repay_strategy", assets: 20n },
      before,
      after: { ...before, debtAssets: 80n, strategyAssets: 60n, withdrawableAssets: 40n },
      receipt: {
        success: true,
        crestEvent: { kind: "repay_strategy", actor: guardian, debtBefore: 100n, debtAfter: 80n, assets: 20n },
        morphoRepay: { beneficiary: account, assets: 20n },
        vaultWithdraw: { owner: account, receiver: account, assets: 20n },
      },
    });
    const byKind = Object.fromEntries(checks.map((check) => [check.kind, check.passed]));

    expect(checks).toHaveLength(4);
    expect(checks.every((check) => check.passed)).toBe(true);
    expect(byKind.debt_decreased).toBe(true);
    expect(byKind.strategy_floor_held).toBe(true);
    expect(byKind.vault_receiver_fixed).toBe(true);
    expect(byKind.repay_beneficiary_fixed).toBe(true);
  });

  test("accepts a canonical repayment whose event begins after Morpho accrual", () => {
    const checks = verifyGuardianPostconditions({
      action: { kind: "repay_reserve", assets: 20n },
      before,
      after: { ...before, debtAssets: 85n, reserveAssets: 20n },
      receipt: {
        success: true,
        crestEvent: { kind: "repay_reserve", actor: guardian, debtBefore: 105n, debtAfter: 85n, assets: 20n },
        morphoRepay: { beneficiary: account, assets: 20n },
      },
    });
    const byKind = Object.fromEntries(checks.map((check) => [check.kind, check.passed]));

    expect(byKind.debt_decreased).toBe(true);
    expect(byKind.reserve_floor_held).toBe(true);
    expect(byKind.repay_beneficiary_fixed).toBe(true);
  });

  test("fails closed when post-state policy, Guardian, or route drifted", () => {
    const checks = verifyGuardianPostconditions({
      action: { kind: "repay_reserve", assets: 10n },
      before,
      after: {
        ...before,
        debtAssets: 90n,
        reserveAssets: 20n,
        policyNonce: 8n,
        policyHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        guardian: other,
        marketId: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        vault: other,
      },
      receipt: {
        success: true,
        crestEvent: { kind: "repay_reserve", actor: guardian, debtBefore: 100n, debtAfter: 90n, assets: 10n },
        morphoRepay: { beneficiary: account, assets: 10n },
      },
    });

    expect(checks.every((check) => !check.passed)).toBe(true);
  });

  test("fails each relevant strategy check on an unsuccessful or redirected receipt", () => {
    const checks = verifyGuardianPostconditions({
      action: { kind: "repay_strategy", assets: 20n },
      before,
      after: { ...before, debtAssets: 100n, strategyAssets: 39n },
      receipt: {
        success: false,
        crestEvent: { kind: "repay_strategy", actor: other, debtBefore: 100n, debtAfter: 100n, assets: 20n },
        morphoRepay: { beneficiary: other, assets: 20n },
        vaultWithdraw: { owner: other, receiver: guardian, assets: 20n },
      },
    });
    const byKind = Object.fromEntries(checks.map((check) => [check.kind, check.passed]));

    expect(checks).toHaveLength(4);
    expect(checks.every((check) => !check.passed)).toBe(true);
    expect(byKind.debt_decreased).toBe(false);
    expect(byKind.strategy_floor_held).toBe(false);
    expect(byKind.vault_receiver_fixed).toBe(false);
    expect(byKind.repay_beneficiary_fixed).toBe(false);
  });

  test("does not infer repayment success when a required receipt event is absent", () => {
    const checks = verifyGuardianPostconditions({
      action: { kind: "repay_reserve", assets: 10n },
      before,
      after: { ...before, debtAssets: 90n, reserveAssets: 20n },
      receipt: { success: true, morphoRepay: { beneficiary: account, assets: 10n } },
    });
    const byKind = Object.fromEntries(checks.map((check) => [check.kind, check.passed]));

    expect(byKind.debt_decreased).toBe(false);
    expect(byKind.reserve_floor_held).toBe(false);
    expect(byKind.repay_beneficiary_fixed).toBe(false);
  });
});
