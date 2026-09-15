import { z } from "zod";

export const uintStringSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
export const positiveUintStringSchema = z.string().regex(/^[1-9][0-9]*$/);
export const integerStringSchema = z.string().regex(/^(0|-?[1-9][0-9]*)$/);

export const baseUnitsSchema = uintStringSchema.transform(BigInt).brand<"BaseUnits">();
export const positiveBaseUnitsSchema = positiveUintStringSchema.transform(BigInt).brand<"BaseUnits">();
export const sharesSchema = uintStringSchema.transform(BigInt).brand<"Shares">();
export const wadSchema = uintStringSchema.transform(BigInt).brand<"Wad">();
export const basisPointsSchema = integerStringSchema.transform(BigInt).brand<"BasisPoints">();
export const blockNumberSchema = uintStringSchema.transform(BigInt).brand<"BlockNumber">();
export const positiveScaleSchema = positiveUintStringSchema.transform(BigInt).brand<"Scale">();

export const rateSchema = z.strictObject({
  value: integerStringSchema.transform(BigInt),
  scale: positiveScaleSchema,
  convention: z.enum(["apr-simple", "apy-compounded"]),
  source: z.url(),
  observedAt: z.iso.datetime({ offset: true }),
  status: z.enum(["normal", "degraded", "unknown"]),
});

export type BaseUnits = z.output<typeof baseUnitsSchema>;
export type Shares = z.output<typeof sharesSchema>;
export type Wad = z.output<typeof wadSchema>;
export type BasisPoints = z.output<typeof basisPointsSchema>;
export type BlockNumber = z.output<typeof blockNumberSchema>;
export type Rate = z.output<typeof rateSchema>;
