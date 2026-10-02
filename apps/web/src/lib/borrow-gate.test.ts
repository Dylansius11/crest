import { describe, expect, test } from "vitest";

import { MAX_ASSESSMENT_AGE_MS, MAX_CLOCK_SKEW_MS, borrowGate, borrowSignatureBlock } from "./borrow-gate";

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

  test("an assessment dated ahead of this clock beyond the skew allowance is untrusted, not fresh forever", () => {
    const ahead = new Date(now + MAX_CLOCK_SKEW_MS + 1).toISOString();
    const withinSkew = new Date(now + MAX_CLOCK_SKEW_MS).toISOString();
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("NORMAL", { createdAt: ahead }), nowMs: now }).kind).toBe("blocked");
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("DEGRADED", { createdAt: ahead }), nowMs: now }).kind).toBe("blocked");
    expect(borrowGate({ trust: "sandbox", frozen: false, assessment: assessment("NORMAL", { createdAt: withinSkew }), nowMs: now }).kind).toBe("open");
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

describe("borrow signature recheck", () => {
  test("a prepared borrow is unsignable once the gate closes, the acknowledgement is withdrawn, or capacity shrinks below it", () => {
    expect(borrowSignatureBlock({ kind: "blocked", reason: "CRITICAL" }, true, 1n)).toBe("CRITICAL");
    expect(borrowSignatureBlock({ kind: "acknowledge", reasonCodes: ["unreadable"] }, false, 1n)).toContain("acknowledgement was withdrawn");
    expect(borrowSignatureBlock({ kind: "acknowledge", reasonCodes: ["unreadable"] }, true, 1n)).toBeNull();
    expect(borrowSignatureBlock({ kind: "open", capacityAssets: 9n }, false, 10n)).toContain("exceeds");
    expect(borrowSignatureBlock({ kind: "open", capacityAssets: 10n }, false, 10n)).toBeNull();
  });
});
