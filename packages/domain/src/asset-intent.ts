import { z } from "zod";
import { marketIdSchema, vaultIdSchema } from "./identity.ts";

export const assetIntentKindSchema = z.enum([
  "KEEP",
  "PROTECT_AND_BORROW",
  "EARN_STABLE",
  "EARN_ASSET",
  "UNSUPPORTED",
]);

export const assetIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("KEEP") }),
  z.strictObject({ kind: z.literal("PROTECT_AND_BORROW"), marketId: marketIdSchema }),
  z.strictObject({ kind: z.literal("EARN_STABLE"), vaultId: vaultIdSchema }),
  z.strictObject({ kind: z.literal("EARN_ASSET"), availability: z.literal("post_mvp") }),
  z.strictObject({ kind: z.literal("UNSUPPORTED"), reasonCodes: z.array(z.string().min(1)).min(1) }),
]);

export type AssetIntentKind = z.output<typeof assetIntentKindSchema>;
export type AssetIntent = z.output<typeof assetIntentSchema>;
