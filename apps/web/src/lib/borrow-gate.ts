/**
 * Recorded assessments older than this are stale for an owner borrow. The monitor polls every 60 s by default,
 * so ten missed polls is an outage, not jitter. Staleness only ever blocks; it never opens a borrow.
 */
export const MAX_ASSESSMENT_AGE_MS = 10 * 60_000;

/** A record dated further ahead than this is untrusted: a skewed clock must not keep an assessment fresh forever. */
export const MAX_CLOCK_SKEW_MS = 60_000;

/** States in which the risk engine leaves owner borrowing available. */
const HEALTHY: Record<string, true> = { NORMAL: true, HARVESTABLE: true, UPSIZE_AVAILABLE: true };

export type BorrowGateInput = {
  trust: "reviewed" | "sandbox";
  /** Recorded snapshot freeze flag; `null` when no snapshot exists. */
  frozen: boolean | null;
  assessment: { status: string; createdAt: string; reasonCodes: readonly string[]; ownerBorrowCapacityAssets: string | null } | null;
  nowMs: number;
};

export type BorrowGate =
  | { kind: "open"; capacityAssets: bigint | null }
  | { kind: "acknowledge"; reasonCodes: readonly string[] }
  | { kind: "blocked"; reason: string };

/**
 * Decides whether the owner may prepare a borrow. Onchain simulation is still required afterwards; this gate can
 * only refuse. DEGRADED is a sandbox-only exception that needs the owner's explicit acknowledgement.
 */
export function borrowGate({ trust, frozen, assessment, nowMs }: BorrowGateInput): BorrowGate {
  if (frozen === null) return { kind: "blocked", reason: "No recorded account snapshot exists yet. Run the monitor after the policy is indexed." };
  if (frozen) return { kind: "blocked", reason: "Borrowing is frozen. Only the owner can unfreeze, and a simulation cannot override it." };
  if (assessment === null) return { kind: "blocked", reason: "No recorded risk assessment exists for the active policy." };
  const created = Date.parse(assessment.createdAt);
  if (Number.isNaN(created) || nowMs - created > MAX_ASSESSMENT_AGE_MS) {
    return { kind: "blocked", reason: `The recorded assessment is stale (older than ${MAX_ASSESSMENT_AGE_MS / 60_000} minutes). Wait for a fresh monitor poll.` };
  }
  if (created - nowMs > MAX_CLOCK_SKEW_MS) {
    return { kind: "blocked", reason: "The recorded assessment is dated ahead of this clock. Check the monitor and browser clocks before borrowing." };
  }
  if (HEALTHY[assessment.status] === true) {
    return { kind: "open", capacityAssets: assessment.ownerBorrowCapacityAssets === null ? null : BigInt(assessment.ownerBorrowCapacityAssets) };
  }
  if (assessment.status === "DEGRADED") {
    return trust === "sandbox"
      ? { kind: "acknowledge", reasonCodes: assessment.reasonCodes }
      : { kind: "blocked", reason: "The recorded assessment is DEGRADED. A reviewed route never borrows on degraded input." };
  }
  return { kind: "blocked", reason: `The recorded assessment is ${assessment.status}. Borrowing stays closed until the account returns to a healthy state.` };
}

/**
 * Re-applies the gate to an already prepared borrow at signature time. A borrow prepared under an open or
 * acknowledged gate stops being signable the moment the recorded state, its age, or the acknowledgement changes.
 */
export function borrowSignatureBlock(gate: BorrowGate, acknowledged: boolean, assets: bigint): string | null {
  if (gate.kind === "blocked") return gate.reason;
  if (gate.kind === "acknowledge") return acknowledged ? null : "The DEGRADED acknowledgement was withdrawn. Acknowledge the reason codes again before signing.";
  if (gate.capacityAssets !== null && assets > gate.capacityAssets) return "The prepared borrow now exceeds the recorded owner capacity. Prepare it again.";
  return null;
}
