import { compactAddress } from "../components/account/format";
import type { RecordedPosition } from "@/components/account/types";
import { MAX_ASSESSMENT_AGE_MS } from "./borrow-gate";
import { activeTokens } from "./manifest";
import { interventionView, OWNER_NEXT_STEP } from "./position-view";

export type HeadlineTone = "stop" | "warn" | "verified" | "neutral";

/** The one sentence the account page leads with, derived only from the recorded position. */
export type PositionHeadline = { tone: HeadlineTone; title: string; detail: string };

/** Plain names for recorded risk inputs; a family name covers every input under its prefix. */
const INPUT_NAME: Record<string, string> = {
  head: "the chain head",
  account: "the account state",
  market: "the Morpho market",
  position: "the Morpho position",
  "oracle.marketPrice": "the Morpho market price",
  "oracle.collateralFeed": `the ${activeTokens.collateral.symbol} price feed`,
  "oracle.loanFeed": `the ${activeTokens.loan.symbol} price feed`,
  vault: "the vault",
  strategy: "the vault position",
  lifecycle: "the Robinhood stock registry",
};

const STATE_HEADLINE: Record<string, PositionHeadline> = {
  PROTECT: { tone: "warn", title: "Above your upper limit", detail: "Custos may freeze new borrowing and repay from the reserve and the vault toward your target." },
  CRITICAL: { tone: "stop", title: "At your critical limit", detail: "Custos may repay from withdrawable vault funds toward your target." },
  EXIT_YIELD: { tone: "warn", title: "The vault no longer meets your policy", detail: "Custos may freeze new borrowing and move vault funds toward your reserve or your debt." },
};

function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * Risk inputs the latest assessment could not read normally, in plain words and recorded order. Rate inputs are
 * left out: an unread rate withholds the carry projection, it does not decide whether borrowing is safe.
 */
export function unreadableInputs(position: RecordedPosition | null): string[] {
  const names: string[] = [];
  for (const recorded of position?.assessment?.provenance ?? []) {
    if (recorded.status === "normal" || recorded.input.startsWith("rates.")) continue;
    const name = INPUT_NAME[recorded.input] ?? INPUT_NAME[recorded.input.split(".")[0] ?? ""] ?? recorded.input;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function positionHeadline(position: RecordedPosition | null, nowMs: number): PositionHeadline {
  if (position === null) return { tone: "neutral", title: "No record yet", detail: "The monitor has not recorded this account yet. Figures appear after its first poll." };
  const { snapshot, assessment } = position;
  if (snapshot === null) return { tone: "neutral", title: "Waiting for the first snapshot", detail: "The account is registered. The monitor records its position once the policy is indexed." };
  const unreadable = list(unreadableInputs(position));

  if (snapshot.frozen) {
    const intervention = interventionView(position.latestIntervention);
    const credited = intervention?.actionKind === "freeze" && intervention.outcome === "verified" && intervention.run?.transactionHash
      ? `Custos froze it in transaction ${compactAddress(intervention.run.transactionHash)}. `
      : "";
    const holding = unreadable ? `It stays frozen while ${unreadable} can't be read. ` : "";
    return { tone: "stop", title: "Borrowing is frozen", detail: `${credited}${holding}Only you can unfreeze it.` };
  }

  if (assessment === null) return { tone: "neutral", title: "Borrowing is closed", detail: "No risk assessment is recorded for the active policy yet." };
  const created = Date.parse(assessment.createdAt);
  if (Number.isNaN(created) || nowMs - created > MAX_ASSESSMENT_AGE_MS) {
    return { tone: "warn", title: "The record is out of date", detail: `The last assessment is older than ${MAX_ASSESSMENT_AGE_MS / 60_000} minutes. Borrowing stays closed until the monitor records a fresh one.` };
  }
  if (assessment.status === "DEGRADED") {
    return { tone: "warn", title: "Some data can't be read", detail: unreadable ? `Borrowing stays restricted while ${unreadable} can't be read.` : "Borrowing stays restricted until every input reads normally." };
  }
  const state = STATE_HEADLINE[assessment.status];
  if (state) return state;
  const nextStep = OWNER_NEXT_STEP[assessment.status];
  if (nextStep) return { tone: "verified", title: "Inside your limits", detail: nextStep };
  return { tone: "neutral", title: `Recorded state ${assessment.status}`, detail: "This state has no plain summary yet. The details below show the recorded assessment." };
}
