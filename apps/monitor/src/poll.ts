import { encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import type { Address } from "viem";

import type { AssessmentRow, TriggerDraft } from "@crest/db";
import { canonicalJson } from "@crest/domain";
import { assessPosition, planGuardianAction } from "@crest/risk";
import type { RiskInput } from "@crest/risk";

export interface PollIdentity {
  accountId: string;
  policyId: string;
  chainId: bigint;
  account: Address;
  at: Date;
}

/** Projected economics live only on the assessment; a Guardian trigger is never made for owner borrowing. */
export function evaluatePoll(input: RiskInput, identity: PollIdentity): { assessment: AssessmentRow; trigger: TriggerDraft | null; strategyActionableAssets: bigint } {
  const result = assessPosition(input);
  const action = planGuardianAction(result);
  const recommendedAction = action?.kind ?? result.ownerRecommendation.kind;
  const health = result.position;
  const assessment: AssessmentRow = {
    id: result.inputHash,
    crestAccountId: identity.accountId,
    policyId: identity.policyId,
    riskEngineVersion: result.engineVersion,
    status: result.state,
    ltvWad: health?.ltvWad ?? null,
    morphoHealthWad: health?.morphoHealth.kind === "finite" ? health.morphoHealth.wad : null,
    policyHealthWad: health?.policyHealth.kind === "finite" ? health.policyHealth.wad : null,
    ownerBorrowCapacityAssets: result.ownerBorrow.capacityAssets,
    repayCapacityAssets: result.repayment.reserveCapacityAssets > result.repayment.strategyCapacityAssets
      ? result.repayment.reserveCapacityAssets : result.repayment.strategyCapacityAssets,
    estimatedAnnualCarryAssets: result.carry?.annualCarryAssets ?? null,
    estimatedSpreadBps: result.carry?.spreadBps ?? null,
    recommendedAction,
    reasonCodes: result.reasons,
    canonicalInputHash: Buffer.from(result.inputHash.slice(2), "hex"),
    inputJson: JSON.parse(canonicalJson(input)) as unknown,
    createdAt: identity.at,
  };
  if (!action) return { assessment, trigger: null, strategyActionableAssets: result.repayment.strategyCapacityAssets };
  const idempotency = keccak256(encodeAbiParameters(
    parseAbiParameters("uint256,address,uint256,bytes32,string"),
    [identity.chainId, identity.account, input.policy.nonce, result.inputHash, action.kind],
  ));
  return {
    strategyActionableAssets: result.repayment.strategyCapacityAssets,
    assessment,
    trigger: {
      id: idempotency,
      idempotencyKey: Buffer.from(idempotency.slice(2), "hex"),
      actionKind: action.kind,
      requestedAssets: action.kind === "freeze" ? null : action.requestedAssets,
      reasonCodes: result.reasons,
    },
  };
}
