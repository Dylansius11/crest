import { z } from "zod";
import { addressSchema, marketIdSchema } from "./identity.ts";
import {
  baseUnitsSchema,
  basisPointsSchema,
  blockNumberSchema,
  positiveBaseUnitsSchema,
  positiveUintStringSchema,
  wadSchema,
} from "./units.ts";

export const verifiedRouteSchema = z.strictObject({
  chainId: blockNumberSchema,
  marketId: marketIdSchema,
  collateralToken: addressSchema,
  loanToken: addressSchema,
  oracle: addressSchema,
  irm: addressSchema,
  vault: addressSchema,
  vaultAsset: addressSchema,
  marketLltvWad: wadSchema,
}).superRefine((route, context) => {
  if (route.loanToken.toLowerCase() !== route.vaultAsset.toLowerCase()) {
    context.addIssue({ code: "custom", message: "vault asset must equal the market loan token", path: ["vaultAsset"] });
  }
});

const positiveCount = positiveUintStringSchema.transform(BigInt);

/**
 * How old each input may be before it is `stale`. Onchain ages are judged against the pinned block, HTTP ages
 * against the evaluation time. A budget only ever tightens: a stale input zeroes owner-borrow capacity.
 */
export const freshnessBudgetSchema = z.strictObject({
  maxHeadLagSeconds: positiveCount,
  maxFeedAgeSeconds: positiveCount,
  maxQuoteAgeSeconds: positiveCount,
  maxAssetAgeSeconds: positiveCount,
  maxCorporateActionsAgeSeconds: positiveCount,
  maxIndexLagBlocks: positiveCount,
});

/** Which degraded source groups make the Guardian freeze owner borrowing. Capacity is zero either way. */
export const degradedTriggersSchema = z.strictObject({
  freezeOnOracleDegraded: z.boolean(),
  freezeOnVaultDegraded: z.boolean(),
  freezeOnLifecycleDegraded: z.boolean(),
});

export const policyV2Schema = z.strictObject({
  schemaVersion: z.literal(2),
  route: verifiedRouteSchema,
  maxCollateralAssets: baseUnitsSchema,
  debtCeilingAssets: baseUnitsSchema,
  maxStrategyAssets: baseUnitsSchema,
  reserveFloorAssets: baseUnitsSchema,
  strategyFloorAssets: baseUnitsSchema,
  maxRepayPerActionAssets: baseUnitsSchema,
  lowerLtvWad: wadSchema,
  targetLtvWad: wadSchema,
  upperLtvWad: wadSchema,
  criticalLtvWad: wadSchema,
  minimumNetSpreadBps: basisPointsSchema,
  /** Largest gap Crest accepts between Morpho's oracle and its own feed-only price before it stops new borrowing. */
  maxOracleDivergenceBps: basisPointsSchema.refine((value) => value >= 0n && value <= 10_000n, "divergence bound must be 0 to 10000 bps"),
  /** Smallest realized strategy surplus worth one Guardian repayment transaction. */
  harvestThresholdAssets: positiveBaseUnitsSchema,
  freshness: freshnessBudgetSchema,
  triggers: degradedTriggersSchema,
  guardian: addressSchema,
}).superRefine((policy, context) => {
  const ordered = policy.lowerLtvWad < policy.targetLtvWad
    && policy.targetLtvWad < policy.upperLtvWad
    && policy.upperLtvWad < policy.criticalLtvWad
    && policy.criticalLtvWad < policy.route.marketLltvWad;
  if (!ordered) context.addIssue({ code: "custom", message: "LTV thresholds must be strictly ordered below the Morpho LLTV", path: ["lowerLtvWad"] });
  if (policy.strategyFloorAssets > policy.maxStrategyAssets) {
    context.addIssue({ code: "custom", message: "strategy floor exceeds strategy cap", path: ["strategyFloorAssets"] });
  }
  if (policy.maxRepayPerActionAssets === 0n) {
    context.addIssue({ code: "custom", message: "Guardian repayment cap must be positive", path: ["maxRepayPerActionAssets"] });
  }
});

export type VerifiedRoute = z.output<typeof verifiedRouteSchema>;
export type FreshnessBudget = z.output<typeof freshnessBudgetSchema>;
export type DegradedTriggers = z.output<typeof degradedTriggersSchema>;
export type PolicyV2 = z.output<typeof policyV2Schema>;
