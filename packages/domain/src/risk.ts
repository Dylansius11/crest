import { z } from "zod";
import { wadSchema } from "./units.ts";

export const healthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("no_debt") }),
  z.strictObject({ kind: z.literal("finite"), wad: wadSchema }),
]);

export const evidenceStatusSchema = z.enum(["normal", "degraded", "unknown"]);

export type Health = z.output<typeof healthSchema>;
export type EvidenceStatus = z.output<typeof evidenceStatusSchema>;
