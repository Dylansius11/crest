import type { EvidenceStatus, Observation, ReasonCode } from "@crest/domain";

import type { CorporateAction, StockTokenAsset, StockTokenQuote } from "./rest.ts";
import type { StockTokenState } from "./token.ts";

export interface LifecycleInputs {
  token: Observation<StockTokenState>;
  asset: Observation<StockTokenAsset>;
  quote: Observation<StockTokenQuote>;
  actions: Observation<CorporateAction[]>;
}

export interface LifecycleBudgets {
  now: () => Date;
  assetMaxAgeSeconds: number;
  quoteMaxAgeSeconds: number;
  actionsMaxAgeSeconds: number;
}

/**
 * The combined lifecycle picture. It is not one observation: every input keeps its own provenance under
 * `inputs`, and the status here only ever combines their reasons. It can say "tighten"; it can never permit.
 */
export interface LifecycleAssessment {
  status: EvidenceStatus;
  reasons: ReasonCode[];
  /** Canonical multiplier: onchain, never the REST copy. Null when the token could not be read. */
  multiplierWad: bigint | null;
  inputs: LifecycleInputs;
}

function ageSeconds(observation: Observation<unknown>, now: Date): number | null {
  if (observation.provenance.kind !== "http") return null;
  const stamp = observation.provenance.generatedAt ?? observation.provenance.fetchedAt;
  return (now.getTime() - new Date(stamp).getTime()) / 1000;
}

export function assessLifecycle(inputs: LifecycleInputs, budgets: LifecycleBudgets): LifecycleAssessment {
  const now = budgets.now();
  const { token, asset, quote, actions } = inputs;
  const reasons: ReasonCode[] = [...token.reasons, ...asset.reasons, ...quote.reasons, ...actions.reasons];

  for (const [observation, budget] of [
    [asset, budgets.assetMaxAgeSeconds],
    [quote, budgets.quoteMaxAgeSeconds],
    [actions, budgets.actionsMaxAgeSeconds],
  ] as const) {
    const age = ageSeconds(observation, now);
    if (observation.value !== null && age !== null && age > budget) reasons.push("stale");
  }

  if (token.value !== null && asset.value !== null) {
    if (token.value.uid.toLowerCase() !== asset.value.uid) reasons.push("identity_mismatch");
    else if (token.value.uiMultiplierWad !== asset.value.currentMultiplierWad) reasons.push("conflict");
  }
  if (asset.value?.pendingMultiplierWad != null) reasons.push("multiplier_pending");
  if (asset.value !== null && asset.value.status !== "ASSET_STATUS_ACTIVE") reasons.push("asset_inactive");
  if (quote.value?.isTradingHalt === true) reasons.push("trading_halt");
  if (actions.value?.some((action) => action.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS") === true) reasons.push("corporate_action_in_progress");

  const unique = reasons.filter((reason, index) => reasons.indexOf(reason) === index);
  const status: EvidenceStatus = token.value === null ? "unknown" : unique.length > 0 ? "degraded" : "normal";
  return { status, reasons: unique, multiplierWad: token.value?.uiMultiplierWad ?? null, inputs };
}
