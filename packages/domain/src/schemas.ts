import type { ZodType } from "zod";
import { assetIntentSchema } from "./asset-intent.ts";
import { projectedOrRealizedSchema } from "./carry.ts";
import { guardianActionSchema, guardianStateSchema } from "./guardian.ts";
import { addressSchema, hashSchema, marketIdSchema, vaultIdSchema } from "./identity.ts";
import { policyV2Schema, verifiedRouteSchema } from "./policy.ts";
import { healthSchema } from "./risk.ts";
import { rateSchema } from "./units.ts";

export const domainSchemas = {
  Address: addressSchema,
  Hash: hashSchema,
  MarketId: marketIdSchema,
  VaultId: vaultIdSchema,
  Rate: rateSchema,
  AssetIntent: assetIntentSchema,
  VerifiedRoute: verifiedRouteSchema,
  PolicyV2: policyV2Schema,
  GuardianState: guardianStateSchema,
  GuardianAction: guardianActionSchema,
  ProjectedOrRealized: projectedOrRealizedSchema,
  Health: healthSchema,
} satisfies Record<string, ZodType>;
