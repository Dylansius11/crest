import { describe, expect, test } from "vitest";

import type { RecordedInput, RecordedIntervention, RecordedPosition } from "@/components/account/types";
import { activeTokens } from "./manifest";
import { positionHeadline, unreadableInputs } from "./position-headline";

const NOW = Date.parse("2026-10-03T07:10:00.000Z");
const pct = (points: number) => (BigInt(points) * 10n ** 16n).toString();

type Snapshot = NonNullable<RecordedPosition["snapshot"]>;
type Assessment = NonNullable<RecordedPosition["assessment"]>;

const rate = { status: "normal", reasons: [], value: null, scale: null, convention: null, window: null, source: null, observedAt: null };
const input = (name: string, status = "normal", reasons: string[] = []): RecordedInput => ({ input: name, status, reasons, source: null, blockNumber: null, observedAt: null });

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  blockNumber: "128008345", blockHash: "0xaa", observedAt: "2026-10-03T07:08:57.637Z", owner: "0x1", guardian: "0x2", frozen: false,
  collateralAssets: "0", debtAssets: "0", collateralValueAssets: null, ltvWad: null, morphoHealthWad: null,
  lowerLtvWad: pct(5), targetLtvWad: pct(10), upperLtvWad: pct(20), criticalLtvWad: pct(40),
  reserveAssets: "0", vaultShares: "0", quotedVaultAssets: "0", withdrawableVaultAssets: "0",
  reserveFloorAssets: "0", strategyFloorAssets: "0", maxRepayPerActionAssets: "10000000",
  ...overrides,
});

const assessment = (overrides: Partial<Assessment> = {}): Assessment => ({
  status: "NORMAL", createdAt: "2026-10-03T07:08:57.633Z", reasonCodes: [], recommendedAction: "none",
  policyHealthWad: null, ownerBorrowCapacityAssets: null, repayCapacityAssets: null, projectedCarryAssets: null, projectedSpreadBps: null,
  rates: { borrow: rate, vault: rate }, provenance: [input("head"), input("market")],
  ...overrides,
});

const position = (overrides: Partial<RecordedPosition> = {}): RecordedPosition => ({
  evidence: "recorded",
  account: { address: "0xad8a", chainId: "46630", codeHash: "0xcc", policyNonce: "3", status: "active" },
  snapshot: snapshot(),
  assessment: assessment(),
  realizedDebtRepaidAssets: null,
  latestRepayment: null,
  latestIntervention: null,
  ...overrides,
});

/** The provenance the live 46630 monitor records: the loan feed and the Stock Token registry are unreadable. */
const sandboxProvenance = [
  input("head"), input("oracle.collateralFeed"),
  input("oracle.loanFeed", "unknown", ["unreadable"]),
  input("rates.borrow", "unknown", ["unreadable"]),
  input("rates.vaultIncentives", "unknown", ["invalid_response"]),
  input("lifecycle.asset", "unknown", ["identity_mismatch"]),
  input("lifecycle.token", "unknown", ["unreadable"]),
];

describe("unreadable inputs", () => {
  test("names each unreadable risk input once in plain words, and leaves rate inputs to the carry panel", () => {
    const recorded = position({ assessment: assessment({ status: "DEGRADED", provenance: sandboxProvenance }) });
    expect(unreadableInputs(recorded)).toEqual([`the ${activeTokens.loan.symbol} price feed`, "the Robinhood stock registry"]);
  });

  test("no record or no assessment means nothing is known to be unreadable", () => {
    expect(unreadableInputs(null)).toEqual([]);
    expect(unreadableInputs(position({ assessment: null }))).toEqual([]);
  });

  test("an input the page has no plain name for keeps its recorded name rather than disappearing", () => {
    const recorded = position({ assessment: assessment({ provenance: [input("oracle.somethingNew", "stale", ["stale"])] }) });
    expect(unreadableInputs(recorded)).toEqual(["oracle.somethingNew"]);
  });
});

describe("position headline", () => {
  test("no record and no snapshot are stated plainly, never as healthy", () => {
    expect(positionHeadline(null, NOW)).toMatchObject({ tone: "neutral", title: "No record yet" });
    expect(positionHeadline(position({ snapshot: null }), NOW)).toMatchObject({ tone: "neutral", title: "Waiting for the first snapshot" });
  });

  test("a frozen account says why it stays frozen and that only the owner can unfreeze", () => {
    const recorded = position({ snapshot: snapshot({ frozen: true }), assessment: assessment({ status: "DEGRADED", provenance: sandboxProvenance }) });
    const headline = positionHeadline(recorded, NOW);
    expect(headline.tone).toBe("stop");
    expect(headline.title).toBe("Borrowing is frozen");
    expect(headline.detail).toContain(`the ${activeTokens.loan.symbol} price feed and the Robinhood stock registry`);
    expect(headline.detail).toContain("Only you can unfreeze it.");
  });

  test("a verified Custos freeze is credited with its transaction; a failed attempt is not", () => {
    const freeze = (status: string, hash: string | null): RecordedIntervention => ({
      actionKind: "freeze", requestedAssets: null, status, reasonCodes: [], detectedAt: "2026-10-02T16:00:00.000Z", forCurrentAssessment: true,
      run: { status, failureClass: status === "failed" ? "pre_sign_validation_or_simulation" : null, transactionHash: hash, checks: [{ kind: "frozen", passed: status === "completed" }] },
    });
    const verified = positionHeadline(position({ snapshot: snapshot({ frozen: true }), latestIntervention: freeze("completed", "0x86daefef76289df87bb66f2e43107d8425f1575a9a56744272e53f3c3f77971d") }), NOW);
    expect(verified.detail).toContain("Custos froze it in transaction 0x86daef…77971d.");
    const failed = positionHeadline(position({ snapshot: snapshot({ frozen: true }), latestIntervention: freeze("failed", null) }), NOW);
    expect(failed.detail).not.toContain("Custos froze it");
  });

  test("an open account inside its band is verified with the owner's next step", () => {
    expect(positionHeadline(position(), NOW)).toMatchObject({ tone: "verified", title: "Inside your limits" });
  });

  test("protect and critical states say what Custos may do, critical as a stop", () => {
    expect(positionHeadline(position({ assessment: assessment({ status: "PROTECT" }) }), NOW)).toMatchObject({ tone: "warn", title: "Above your upper limit" });
    expect(positionHeadline(position({ assessment: assessment({ status: "CRITICAL" }) }), NOW)).toMatchObject({ tone: "stop", title: "At your critical limit" });
  });

  test("degraded input while open restricts borrowing and names the input", () => {
    const headline = positionHeadline(position({ assessment: assessment({ status: "DEGRADED", provenance: sandboxProvenance }) }), NOW);
    expect(headline).toMatchObject({ tone: "warn", title: "Some data can't be read" });
    expect(headline.detail).toContain("the Robinhood stock registry");
  });

  test("a stale or missing assessment never reads as healthy", () => {
    expect(positionHeadline(position({ assessment: assessment({ createdAt: "2026-10-03T06:50:00.000Z" }) }), NOW)).toMatchObject({ tone: "warn", title: "The record is out of date" });
    expect(positionHeadline(position({ assessment: assessment({ createdAt: "not a date" }) }), NOW)).toMatchObject({ tone: "warn", title: "The record is out of date" });
    expect(positionHeadline(position({ assessment: null }), NOW)).toMatchObject({ tone: "neutral", title: "Borrowing is closed" });
  });
});
