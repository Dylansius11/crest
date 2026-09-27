import { z } from "zod";

import { integerStringSchema } from "@crest/domain";

import { BPS } from "./math.ts";

/**
 * Deterministic stress scenarios, versioned as one set.
 *
 * Every shock is adverse by construction: collateral and exit liquidity can only fall, the borrow rate can only
 * rise, and the vault rate can only fall. A scenario that could loosen any bound is rejected at parse time, so
 * no scenario can ever show more owner-borrow capacity than the unstressed position.
 */

const shockBps = integerStringSchema.transform(BigInt);

const shocksSchema = z.strictObject({
  /** Change to both Morpho's oracle price and Crest's feed-only price. -10000 to 0. */
  collateralPriceBps: shockBps.refine((value) => value >= -BPS && value <= 0n, "collateral shock must be -10000 to 0 bps").optional(),
  /** Absolute rise in borrow APY, in bps of rate. 0 or more. */
  borrowApyShiftBps: shockBps.refine((value) => value >= 0n, "borrow APY shock must not lower the rate").optional(),
  /** Absolute fall in vault APY, in bps of rate. 0 or less. */
  vaultApyShiftBps: shockBps.refine((value) => value <= 0n, "vault APY shock must not raise the rate").optional(),
  /** Change to currently withdrawable vault assets. -10000 to 0. */
  vaultLiquidityBps: shockBps.refine((value) => value >= -BPS && value <= 0n, "liquidity shock must be -10000 to 0 bps").optional(),
});

const SHOCKS_BY_KIND = {
  collateral_drop: ["collateralPriceBps"],
  spread_inversion: ["borrowApyShiftBps", "vaultApyShiftBps"],
  vault_liquidity: ["vaultLiquidityBps"],
} as const satisfies Record<string, ReadonlyArray<keyof z.output<typeof shocksSchema>>>;

const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  kind: z.enum(["collateral_drop", "spread_inversion", "vault_liquidity"]),
  label: z.string().min(1),
  rationale: z.string().min(1),
  shocks: shocksSchema,
}).superRefine((scenario, context) => {
  const allowed: readonly string[] = SHOCKS_BY_KIND[scenario.kind];
  const present = Object.keys(scenario.shocks);
  if (present.length === 0) context.addIssue({ code: "custom", message: "a scenario needs at least one shock", path: ["shocks"] });
  for (const key of present.filter((name) => !allowed.includes(name))) {
    context.addIssue({ code: "custom", message: `${scenario.kind} cannot carry ${key}`, path: ["shocks", key] });
  }
});

const scenarioSetSchema = z.strictObject({
  schemaVersion: z.literal(2),
  version: z.string().min(1),
  /** `illustrative` until calibrated against price, rate, and withdrawal history. Mirrors the database check. */
  status: z.enum(["illustrative", "calibrated"]),
  provenance: z.string().min(1),
  scenarios: z.array(scenarioSchema).min(1),
}).superRefine((set, context) => {
  const ids = set.scenarios.map((scenario) => scenario.id);
  ids.forEach((id, index) => {
    if (ids.indexOf(id) !== index) context.addIssue({ code: "custom", message: `duplicate scenario id ${id}`, path: ["scenarios", index, "id"] });
  });
});

export type ScenarioShocks = z.output<typeof shocksSchema>;
export type StressScenario = z.output<typeof scenarioSchema>;
export type ScenarioSet = z.output<typeof scenarioSetSchema>;

/** Parses a scenario set, throwing with every issue when it would weaken any bound. */
export function parseScenarioSet(raw: unknown): ScenarioSet {
  const parsed = scenarioSetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid scenario set: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
  return parsed.data;
}
