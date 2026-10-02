import { describe, expect, test } from "vitest";

import { MAX_ASSESSMENT_AGE_MS, borrowGate } from "./borrow-gate";

const now = Date.parse("2026-10-02T12:00:00Z");
const fresh = new Date(now - 60_000).toISOString();
const assessment = (status: string, overrides: Partial<{ createdAt: string; reasonCodes: string[]; ownerBorrowCapacityAssets: string | null }> = {}) => ({
  status,
  createdAt: fresh,
  reasonCodes: [],
  ownerBorrowCapacityAssets: "5000000",
  ...overrides,
});

describe("owner borrow gate", () => {
  test("a frozen account blocks borrowing on every route, even with a healthy assessment", () => {
    expect(borrowGate({ trust: "sandbox", frozen: true, assessment: assessment("NORMAL"), nowMs: now }).kind).toBe("blocked");
  });

  test("a missing snapshot or assessment blocks borrowing", () => {
    expect(borrowGate({ trust: "sandbox", frozen: null, assessment: assessment("NORMAL"), nowMs: now }).kind).toBe("blocked");
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: null, nowMs: now }).kind).toBe("blocked");
  });

  test("an assessment older than the freshness window blocks borrowing, and an unreadable timestamp counts as stale", () => {
    const stale = new Date(now - MAX_ASSESSMENT_AGE_MS - 1).toISOString();
    const edge = new Date(now - MAX_ASSESSMENT_AGE_MS).toISOString();
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("NORMAL", { createdAt: stale }), nowMs: now }).kind).toBe("blocked");
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("NORMAL", { createdAt: edge }), nowMs: now }).kind).toBe("open");
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("NORMAL", { createdAt: "not a date" }), nowMs: now }).kind).toBe("blocked");
  });

  test("a healthy assessment opens borrowing bounded by the recorded owner capacity", () => {
    expect(borrowGate({ trust: "reviewed", frozen: false, assessment: assessment("UPSIZE_AVAILABLE"), nowMs: now })).toEqual({ kind: "open", capacityAssets: 5_000_000n });
  });

  test("DEGRADED requires an explicit acknowledgement on the sandbox and carries its reason codes", () => {
    const gate = borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("DEGRADED", { reasonCodes: ["oracle_unverified", "rates_unavailable"], ownerBorrowCapacityAssets: "0" }), nowMs: now });
    expect(gate).toEqual({ kind: "acknowledge", reasonCodes: ["oracle_unverified", "rates_unavailable"] });
  });

  test("DEGRADED stays blocked on a reviewed route; acknowledgement is a sandbox-only escape", () => {
    expect(borrowGate({ trust: "reviewed", frozen: false, assessment: assessment("DEGRADED", { ownerBorrowCapacityAssets: "0" }), nowMs: now }).kind).toBe("blocked");
  });

  test("protective states block borrowing on every route", () => {
    for (const status of ["PROTECT", "EXIT_YIELD", "CRITICAL", "SOMETHING_NEW"]) {
      expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment(status), nowMs: now }).kind).toBe("blocked");
    }
  });
});
