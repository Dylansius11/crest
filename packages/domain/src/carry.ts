import { z } from "zod";
import { hashSchema } from "./identity.ts";
import { baseUnitsSchema, basisPointsSchema, blockNumberSchema, integerStringSchema } from "./units.ts";

export const projectedCarrySchema = z.strictObject({
  kind: z.literal("projected"),
  annualCarryAssets: integerStringSchema.transform(BigInt),
  spreadBps: basisPointsSchema,
  observedAt: z.iso.datetime({ offset: true }),
});

export const realizedDebtReductionSchema = z.strictObject({
  kind: z.literal("realized"),
  transactionHash: hashSchema,
  blockNumber: blockNumberSchema,
  debtBeforeAssets: baseUnitsSchema,
  debtAfterAssets: baseUnitsSchema,
  debtRepaidAssets: baseUnitsSchema.refine((value) => value > 0n, "realized debt reduction must be positive"),
}).superRefine((value, context) => {
  if (value.debtAfterAssets >= value.debtBeforeAssets) {
    context.addIssue({ code: "custom", message: "realized debt must decrease", path: ["debtAfterAssets"] });
  }
  if (value.debtBeforeAssets - value.debtAfterAssets !== value.debtRepaidAssets) {
    context.addIssue({ code: "custom", message: "debt reduction does not reconcile", path: ["debtRepaidAssets"] });
  }
});


export const projectedOrRealizedSchema = z.union([projectedCarrySchema, realizedDebtReductionSchema]);

export type ProjectedCarry = z.output<typeof projectedCarrySchema>;
export type RealizedDebtReduction = z.output<typeof realizedDebtReductionSchema>;
