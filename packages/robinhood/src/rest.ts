import { z } from "zod";

import { observe, parseDecimalUnits, readJson } from "@crest/domain";
import type { Fetch, Observation } from "@crest/domain";

/**
 * Robinhood Stock Token REST adapters: advisory lifecycle context only.
 *
 * Nothing here is a price or a permission. Identity is always the (chainId, contract address) deployment pair;
 * the ticker is used only to build the documented `/prices/{symbol}` URL, and the quote is then re-matched by
 * deployment. Schemas are strict on the fields Crest reads and ignore fields it does not.
 */

export interface StockTokenRef {
  chainId: number;
  address: string;
}

const decimalText = z.string().regex(/^\d+(\.\d+)?$/);
const uid = z.string().regex(/^0x[0-9a-f]{64}$/);
const deployment = z.object({ contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainId: z.number().int() });

const assetSchema = z.object({
  id: uid,
  tokenSymbol: z.string().min(1),
  deployments: z.array(deployment),
  currentMultiplier: decimalText,
  pendingMultiplier: z.union([z.literal(""), decimalText]),
  pendingMultiplierEffectiveTime: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(["ASSET_STATUS_UNSPECIFIED", "ASSET_STATUS_ACTIVE", "ASSET_STATUS_INACTIVE"]),
});
const assetsResponseSchema = z.object({ assets: z.array(assetSchema) });

const quoteSchema = z.object({
  tokenSymbol: z.string().min(1),
  deployments: z.array(deployment),
  bid: decimalText,
  ask: decimalText,
  currency: z.string().min(1),
  isTradingHalt: z.boolean(),
  generatedAt: z.iso.datetime({ offset: true }),
});
const quotesResponseSchema = z.object({ quotes: z.array(quoteSchema) });

const corporateActionSchema = z.object({
  id: uid,
  // Forward-compatible: Robinhood documents types that are not active yet. An unknown type is kept, not dropped.
  type: z.string().regex(/^CORPORATE_ACTION_TYPE_[A-Z_]+$/),
  status: z.enum(["CORPORATE_ACTION_STATUS_UNSPECIFIED", "CORPORATE_ACTION_STATUS_IN_PROGRESS", "CORPORATE_ACTION_STATUS_COMPLETED"]),
  processDate: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }).nullable().optional(),
  tokenSymbol: z.string().min(1),
  deployments: z.array(deployment),
  details: z.record(z.string(), z.unknown()),
});
const corporateActionsResponseSchema = z.object({ corpActions: z.array(corporateActionSchema) });

/** Documented cache windows (Robinhood Stock Token API reference). `/assets` documents none. */
const PRICES_CACHE_SECONDS = 15;
const CORPORATE_ACTIONS_CACHE_SECONDS = 3_600;

export interface StockTokenAsset {
  uid: string;
  symbol: string;
  currentMultiplierWad: bigint;
  pendingMultiplierWad: bigint | null;
  pendingEffectiveAt: string | null;
  status: z.output<typeof assetSchema>["status"];
}

export interface StockTokenQuote {
  symbol: string;
  /** Raw underlying-equity bid/ask, not multiplier-adjusted. Display context only, never collateral value. */
  bid: string;
  ask: string;
  currency: string;
  isTradingHalt: boolean;
}

export interface CorporateAction {
  id: string;
  type: string;
  status: z.output<typeof corporateActionSchema>["status"];
  processDate: { year: number; month: number; day: number } | null;
  details: Record<string, unknown>;
}

function deploys(deployments: ReadonlyArray<{ contractAddress: string; chainId: number }>, token: StockTokenRef): boolean {
  return deployments.some((entry) => entry.chainId === token.chainId && entry.contractAddress.toLowerCase() === token.address.toLowerCase());
}

/** Asset metadata and the corporate-action multiplier for exactly this deployment. */
export async function fetchStockTokenAsset(fetchFn: Fetch, baseUrl: string, token: StockTokenRef, options: { now: () => Date }): Promise<Observation<StockTokenAsset>> {
  const response = await readJson(fetchFn, { url: `${baseUrl}/assets`, schema: assetsResponseSchema, now: options.now });
  if (response.value === null) return observe<StockTokenAsset>(null, response.provenance, response.reasons);
  const asset = response.value.assets.find((entry) => deploys(entry.deployments, token));
  if (asset === undefined) return observe<StockTokenAsset>(null, response.provenance, ["identity_mismatch"]);
  return observe(
    {
      uid: asset.id,
      symbol: asset.tokenSymbol,
      currentMultiplierWad: parseDecimalUnits(asset.currentMultiplier, 18),
      pendingMultiplierWad: asset.pendingMultiplier === "" ? null : parseDecimalUnits(asset.pendingMultiplier, 18),
      pendingEffectiveAt: asset.pendingMultiplierEffectiveTime ?? null,
      status: asset.status,
    },
    response.provenance,
  );
}

/** Advisory underlying quote and trading-halt flag. A halt does not prove transfers or liquidations stopped. */
export async function fetchQuote(fetchFn: Fetch, baseUrl: string, symbol: string, token: StockTokenRef, options: { now: () => Date }): Promise<Observation<StockTokenQuote>> {
  const response = await readJson(fetchFn, {
    url: `${baseUrl}/prices/${encodeURIComponent(symbol)}`,
    schema: quotesResponseSchema,
    now: options.now,
    cacheSeconds: PRICES_CACHE_SECONDS,
    generatedAt: (body) => body.quotes[0]?.generatedAt ?? null,
  });
  if (response.value === null) return observe<StockTokenQuote>(null, response.provenance, response.reasons);
  const quote = response.value.quotes.find((entry) => deploys(entry.deployments, token));
  if (quote === undefined) return observe<StockTokenQuote>(null, response.provenance, ["identity_mismatch"]);
  return observe(
    { symbol: quote.tokenSymbol, bid: quote.bid, ask: quote.ask, currency: quote.currency, isTradingHalt: quote.isTradingHalt },
    response.provenance,
  );
}

/**
 * Processed corporate actions for this deployment. The endpoint returns a recent window, so an empty list
 * means no action in that window, not that the token never had one.
 */
export async function fetchCorporateActions(fetchFn: Fetch, baseUrl: string, token: StockTokenRef, options: { now: () => Date }): Promise<Observation<CorporateAction[]>> {
  const response = await readJson(fetchFn, {
    url: `${baseUrl}/corporate-actions`,
    schema: corporateActionsResponseSchema,
    now: options.now,
    cacheSeconds: CORPORATE_ACTIONS_CACHE_SECONDS,
  });
  if (response.value === null) return observe<CorporateAction[]>(null, response.provenance, response.reasons);
  return observe(
    response.value.corpActions
      .filter((action) => deploys(action.deployments, token))
      .map((action) => ({ id: action.id, type: action.type, status: action.status, processDate: action.processDate ?? null, details: action.details })),
    response.provenance,
  );
}
