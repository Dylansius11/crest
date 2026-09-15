import { z } from "zod";
import { positiveBaseUnitsSchema } from "./units.ts";

export const guardianStateSchema = z.enum([
  "NORMAL",
  "HARVESTABLE",
  "UPSIZE_AVAILABLE",
  "PROTECT",
  "EXIT_YIELD",
  "CRITICAL",
  "DEGRADED",
]);

export const recommendedActionKindSchema = z.enum([
  "none",
  "owner_borrow",
  "freeze",
  "repay_reserve",
  "repay_strategy",
  "owner_review",
]);

export const guardianActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("freeze"), selector: z.literal("freezeBorrowing()") }),
  z.strictObject({
    kind: z.literal("repay_reserve"),
    selector: z.literal("repayFromReserve(uint256)"),
    requestedAssets: positiveBaseUnitsSchema,
  }),
  z.strictObject({
    kind: z.literal("repay_strategy"),
    selector: z.literal("repayFromStrategy(uint256)"),
    requestedAssets: positiveBaseUnitsSchema,
  }),
]);

export type GuardianState = z.output<typeof guardianStateSchema>;
export type RecommendedActionKind = z.output<typeof recommendedActionKindSchema>;
export type GuardianAction = z.output<typeof guardianActionSchema>;
