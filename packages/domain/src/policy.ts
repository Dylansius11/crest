import { z } from "zod";
import { addressSchema, marketIdSchema } from "./identity.ts";
import {
  baseUnitsSchema,
  basisPointsSchema,
  blockNumberSchema,
  wadSchema,
} from "./units.ts";

export const verifiedRouteSchema = z.strictObject({
  chainId: blockNumberSchema,
  marketId: marketIdSchema,
  collateralToken: addressSchema,
  loanToken: addressSchema,
  vault: addressSchema,
  vaultAsset: addressSchema,
  marketLltvWad: wadSchema,
}).superRefine((route, context) => {
  if (route.loanToken.toLowerCase() !== route.vaultAsset.toLowerCase()) {
    context.addIssue({ code: "custom", message: "vault asset must equal the market loan token", path: ["vaultAsset"] });
  }
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
export type PolicyV2 = z.output<typeof policyV2Schema>;
