import { describe, expect, test } from "vitest";
import { fixture, ACCOUNT } from "@crest/risk/test-fixtures";
import { evaluatePoll } from "./poll.ts";

const accountId = "d5792010-ef0c-4abe-8979-e15377e99f9d";
const policyId = "97b0d37f-756b-45f4-8b9b-6e84edcc4434";

describe("monitor assessment and action selection", () => {
  test("replay has the same key and never promotes projected carry into realized debt", () => {
    const input = fixture({ debtAssets: 1_500_000_000n, strategyQuotedAssets: 1_000_000_000n, strategyAvailableAssets: 1_000_000_000n });
    const first = evaluatePoll(input, { accountId, policyId, chainId: 4663n, account: ACCOUNT, at: new Date("2026-09-24T12:00:00Z") });
    const replay = evaluatePoll(input, { accountId, policyId, chainId: 4663n, account: ACCOUNT, at: new Date("2026-09-24T12:01:00Z") });
    expect(first.assessment.id).toBe(replay.assessment.id);
    expect(first.trigger?.idempotencyKey).toEqual(replay.trigger?.idempotencyKey);
    expect(first.assessment.inputJson).toEqual(replay.assessment.inputJson);
    expect(first.strategyActionableAssets).toBe(500_000_000n);
    expect(first.assessment.estimatedAnnualCarryAssets).not.toBeUndefined();
    expect("debtRepaidAssets" in first.assessment).toBe(false);
  });

  test("owner borrow recommendation never creates Guardian trigger", () => {
    const input = fixture({ debtAssets: 100_000_000n, strategyQuotedAssets: 100_000_000n });
    const result = evaluatePoll(input, { accountId, policyId, chainId: 4663n, account: ACCOUNT, at: new Date("2026-09-24T12:00:00Z") });
    expect(result.assessment.recommendedAction).toBe("owner_borrow");
    expect(result.trigger).toBeNull();
  });

  test("stale source can freeze but cannot produce a repayment or additional borrowing", () => {
    const input = fixture({ debtAssets: 1_500_000_000n, idleReserveAssets: 500_000_000n });
    input.position = { ...input.position, reasons: ["stale"], status: "degraded" };
    const result = evaluatePoll(input, { accountId, policyId, chainId: 4663n, account: ACCOUNT, at: new Date("2026-09-24T12:00:00Z") });
    expect(result.assessment.ownerBorrowCapacityAssets).toBe(0n);
    expect(result.trigger?.actionKind).toBe("freeze");
  });
});
