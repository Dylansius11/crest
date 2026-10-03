import { CircleAlert, CircleCheck, CircleX } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Cell, Fact } from "@/components/ui/cell";
import { MAX_ASSESSMENT_AGE_MS, MAX_CLOCK_SKEW_MS } from "@/lib/borrow-gate";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { ACTION_SELECTOR, OWNER_NEXT_STEP, capitalView, interventionView, type InterventionOutcome } from "@/lib/position-view";
import { compactAddress, decimal } from "./format";
import type { RecordedPosition } from "./types";

const { loan } = activeTokens;

type Tone = NonNullable<BadgeProps["tone"]>;

const STATE_TONE: Record<string, Tone> = {
  NORMAL: "verified", HARVESTABLE: "verified", UPSIZE_AVAILABLE: "neutral",
  PROTECT: "warn", EXIT_YIELD: "warn", CRITICAL: "stop", DEGRADED: "degraded",
};

const ACTION_LABEL: Record<string, string> = {
  none: "No action",
  owner_borrow: "Owner borrow recommendation",
  owner_review: "Owner review",
  freeze: "Freeze borrowing",
  repay_reserve: "Repay from reserve",
  repay_strategy: "Repay from fixed vault",
};

const OUTCOME: Record<InterventionOutcome, { label: string; tone: Tone }> = {
  "verified": { label: "Verified", tone: "verified" },
  "postcondition-failed": { label: "Postcondition failed", tone: "stop" },
  "pending": { label: "Awaiting reconciliation", tone: "warn" },
  "failed": { label: "Failed before signing", tone: "neutral" },
  "detected": { label: "Detected, not claimed", tone: "neutral" },
  "superseded": { label: "Superseded", tone: "neutral" },
};

const CHECK_LABEL: Record<string, string> = {
  frozen: "Borrowing frozen",
  debt_decreased: "Debt decreased",
  reserve_floor_held: "Reserve floor held",
  strategy_floor_held: "Strategy floor held",
  vault_receiver_fixed: "Vault paid only this account",
  repay_beneficiary_fixed: "Repaid only this account's debt",
};

const amount = (value: string | null | undefined) => decimal(value, loan.decimals, loan.symbol);

/**
 * Guardian state card (DESIGN-SYSTEMS 7.7): what the engine concluded, the one selector Custos may call for it,
 * and what Custos last did with its receipt and postconditions. Owner actions never carry a Guardian selector.
 */
export function GuardianStateCard({ position, nowMs }: { position: RecordedPosition; nowMs: number }) {
  const { assessment, snapshot } = position;
  const intervention = interventionView(position.latestIntervention);
  const skippedBeforeSigning = intervention?.run?.failureClass === "pre_sign_validation_or_simulation" && !intervention.run.transactionHash;
  const capital = snapshot === null ? null : capitalView(snapshot, assessment);
  const created = assessment === null ? Number.NaN : Date.parse(assessment.createdAt);
  const stale = assessment !== null && (Number.isNaN(created) || nowMs - created > MAX_ASSESSMENT_AGE_MS || created - nowMs > MAX_CLOCK_SKEW_MS);
  const selector = assessment === null ? null : ACTION_SELECTOR[assessment.recommendedAction] ?? null;

  return (
    <Cell index="Custos" meta="Crest Guardian" className="bg-paper">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="type-display text-poster-sm text-ink-soft">Assessed state</p>
            <p className="type-display mt-1 text-poster-lg">{assessment?.status.replaceAll("_", " ") ?? "Not assessed"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {assessment ? <Badge tone={STATE_TONE[assessment.status] ?? "neutral"}>{assessment.status}</Badge> : <Badge tone="degraded">No assessment</Badge>}
            {stale ? <Badge tone="warn">Stale</Badge> : null}
            {snapshot?.frozen ? <Badge tone="stop">Frozen</Badge> : null}
          </div>
        </div>
        {assessment ? (
          <>
            <p className="mt-2 font-mono text-xs text-ink-soft">{assessment.createdAt}{stale ? `, older than ${MAX_ASSESSMENT_AGE_MS / 60_000} minutes or ahead of this clock` : ""}</p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Reason codes">
              {assessment.reasonCodes.length === 0
                ? <li className="text-sm text-ink-soft">No reason codes.</li>
                : assessment.reasonCodes.map((code) => <li key={code} className="border border-ink px-2 py-1 font-mono text-xs">{code}</li>)}
            </ul>
          </>
        ) : <p className="mt-3 text-sm text-ink-soft">The monitor has not recorded an assessment for this account and policy, so no Guardian action is planned.</p>}

        <dl className="mt-4 border-t border-ink pt-1">
          <Fact label="Recommended">{assessment ? ACTION_LABEL[assessment.recommendedAction] ?? assessment.recommendedAction : "None"}</Fact>
          <Fact label="Permitted selector">{selector ?? (assessment?.recommendedAction === "owner_borrow" ? "None: borrowAndDeploy is owner only" : "None")}</Fact>
          <Fact label="Policy version">nonce {position.account.policyNonce}</Fact>
          <Fact label="Per-action cap">{amount(snapshot?.maxRepayPerActionAssets)}</Fact>
          <Fact label="Guardian-actionable now">{capital === null || capital.actionableAssets === null ? "Not assessed" : amount(capital.actionableAssets.toString())}</Fact>
          <Fact label="Guardian address">{compactAddress(snapshot?.guardian)}</Fact>
        </dl>
        <p className="mt-3 border-l-2 border-ink pl-3 text-sm"><span className="type-display text-poster-sm">Your next step. </span>{assessment ? OWNER_NEXT_STEP[assessment.status] ?? "Review the recorded reasons." : "Run the monitor after the policy is indexed."}</p>
      </div>

      <div className="border-t border-ink p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-display text-poster-sm">Last intervention</p>
          {intervention ? <Badge tone={skippedBeforeSigning ? "neutral" : OUTCOME[intervention.outcome].tone}>{skippedBeforeSigning ? "Skipped before signing" : OUTCOME[intervention.outcome].label}</Badge> : null}
        </div>
        {intervention ? (
          <>
            {skippedBeforeSigning ? <p className="mt-2 text-sm">Skipped before signing. Nothing was signed.</p> : null}
            <dl className="mt-2">
              <Fact label="Action">{ACTION_LABEL[intervention.actionKind] ?? intervention.actionKind}{intervention.forCurrentAssessment ? null : <span className="block font-sans text-xs break-normal text-ink-soft">From an earlier assessment</span>}</Fact>
              <Fact label="Selector">{intervention.selector ?? "None"}</Fact>
              <Fact label="Requested and simulated">{intervention.requestedAssets === null ? "No amount (freeze)" : amount(intervention.requestedAssets)}</Fact>
              <Fact label="Detected">{intervention.detectedAt}</Fact>
              {intervention.run?.failureClass ? <Fact label="Failure detail"><details><summary className="min-h-11 cursor-pointer content-center underline underline-offset-4">Show recorded failure class</summary><span className="font-mono text-xs">{intervention.run.failureClass}</span></details></Fact> : null}
              <Fact label="Transaction">
                {intervention.run?.transactionHash
                  ? <a className="underline underline-offset-4" href={`${activeManifest.network.explorerUrl}/tx/${intervention.run.transactionHash}`} target="_blank" rel="noreferrer">{compactAddress(intervention.run.transactionHash)}</a>
                  : "None signed"}
              </Fact>
            </dl>
            {intervention.run && intervention.run.checks.length > 0 ? (
              <ul className="mt-3 grid gap-1.5" aria-label="Postcondition checks">
                {intervention.run.checks.map((check) => (
                  <li key={check.kind} className="flex items-center gap-2 text-sm">
                    {check.passed ? <CircleCheck aria-hidden className="size-4 text-signal-verified" /> : <CircleX aria-hidden className="size-4 text-signal-stop" />}
                    <span>{CHECK_LABEL[check.kind] ?? check.kind}</span>
                    <span className="sr-only">{check.passed ? "passed" : "failed"}</span>
                  </li>
                ))}
              </ul>
            ) : intervention.run?.status === "completed" ? null : (
              skippedBeforeSigning ? null : <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft"><CircleAlert aria-hidden className="size-4" />No postcondition evidence yet.</p>
            )}
          </>
        ) : <p className="mt-2 text-sm text-ink-soft">Custos has not acted on this account. It can only freeze or repay this account&apos;s own debt.</p>}
        {capital?.floorReached ? <p className="mt-3 border-l-2 border-signal-warn pl-3 text-sm">Floor reached: reserve and strategy sit at their floors, so Custos can freeze but cannot repay.</p> : null}
      </div>
    </Cell>
  );
}
