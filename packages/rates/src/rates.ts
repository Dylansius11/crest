import { getAddress } from "viem";
import type { Address, Hex } from "viem";
import { z } from "zod";

import { observe, parseDecimalUnits, readJson } from "@crest/domain";
import type { Fetch, Observation, Rate, ReasonCode } from "@crest/domain";
import type { MarketSnapshot } from "@crest/morpho";
import type { VaultSnapshot } from "@crest/vault";

/**
 * Rate observations, kept apart by what they measure.
 *
 * Borrow cost, native vault yield, reward programs, and vault fees are different facts from different sources
 * with different conventions. This module normalizes each into exact WAD integers and labels it, and it never
 * adds one to another. Whether two rates may be compared at all is decided by `comparability`.
 */

export const MORPHO_API = "https://api.morpho.org";
const WAD = 10n ** 18n;
/** Morpho's IRM and fee math annualize over 365 days. */
export const SECONDS_PER_YEAR = 31_536_000n;

/** ISO-8601 durations, plus `instant` for a point-in-time onchain rate and `inception` for since-launch. */
export type RateWindow = "instant" | "PT1H" | "PT6H" | "P1D" | "P7D" | "P30D" | "P90D" | "P1Y" | "inception";

export interface RateValue {
  kind: "market_borrow" | "vault_native";
  value: bigint;
  scale: bigint;
  convention: Rate["convention"];
  window: RateWindow;
}

export interface Incentive {
  token: Address;
  symbol: string;
  side: "borrow" | "supply";
  aprWad: bigint;
  convention: "apr-simple";
}

export interface VaultFees {
  /** Share of vault interest taken as fee, WAD fraction. */
  performanceFeeWad: bigint;
  /** Annualized management fee on assets, simple APR in WAD. */
  managementFeeAprWad: bigint;
}

export interface IndexReference {
  /** Pinned chain head the indexed value is judged against. */
  headBlock: bigint;
  /** Largest indexer lag, in blocks, still treated as fresh. */
  maxIndexLagBlocks: bigint;
}

const MARKET_WINDOWS = { "24h": "P1D", "7d": "P7D", "30d": "P30D", "90d": "P90D", "1y": "P1Y" } as const satisfies Record<string, RateWindow>;
const VAULT_LOOKBACKS = {
  one_hour: "PT1H",
  six_hours: "PT6H",
  one_day: "P1D",
  seven_days: "P7D",
  thirty_days: "P30D",
  ninety_days: "P90D",
  one_year: "P1Y",
  inception: "inception",
} as const satisfies Record<string, RateWindow>;

export type MarketAverageWindow = keyof typeof MARKET_WINDOWS;
export type VaultLookback = keyof typeof VAULT_LOOKBACKS;

const blockText = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const averages = z.object({ "24h": z.number().nullable(), "7d": z.number().nullable(), "30d": z.number().nullable(), "90d": z.number().nullable(), "1y": z.number().nullable() });

const marketAveragesSchema = z.object({
  data: z.object({ chain_id: z.number().int(), market_id: hex32, last_indexed_block: blockText, borrow_apy_averages: averages }),
});

const vaultAverageSchema = z.object({
  data: z.object({
    chain_id: z.number().int(),
    vault_address: hex20,
    last_indexed_block: blockText,
    lookback: z.enum(Object.keys(VAULT_LOOKBACKS) as [VaultLookback, ...VaultLookback[]]),
    apy: z.number().nullable(),
  }),
});

const rewardSchema = z.object({
  asset: z.object({ address: hex20, symbol: z.string() }),
  supplyApr: z.number().nullable().optional(),
  borrowApr: z.number().nullable().optional(),
});
const vaultRewardsSchema = z.object({ data: z.object({ vaultV2ByAddress: z.object({ address: hex20, rewards: z.array(rewardSchema) }) }) });
const marketRewardsSchema = z.object({ data: z.object({ marketById: z.object({ marketId: hex32, state: z.object({ rewards: z.array(rewardSchema) }) }) }) });

interface FetchOptions {
  now: () => Date;
  reference: IndexReference;
}

/** Indexed values are judged by how far the indexer trails the pinned chain head, the only clock it exposes. */
function indexReasons(indexedBlock: bigint | null, reference: IndexReference): ReasonCode[] {
  return indexedBlock !== null && reference.headBlock > indexedBlock && reference.headBlock - indexedBlock > reference.maxIndexLagBlocks
    ? ["stale"]
    : [];
}

/** JSON floats arrive as IEEE doubles; their shortest decimal form is parsed exactly, once. */
function wadOf(value: number): bigint {
  return parseDecimalUnits(String(value), 18);
}

/** Trailing-average protocol borrow APY for the reviewed market, from Morpho's indexed REST API. */
export async function fetchMarketBorrowApy(
  fetchFn: Fetch,
  market: { chainId: number; marketId: Hex },
  window: MarketAverageWindow,
  options: FetchOptions,
): Promise<Observation<RateValue>> {
  const response = await readJson(fetchFn, {
    url: `${MORPHO_API}/v0/blue/markets/${market.chainId}:${market.marketId}/apy-averages`,
    schema: marketAveragesSchema,
    now: options.now,
    indexedBlock: (body) => BigInt(body.data.last_indexed_block),
  });
  if (response.value === null) return observe<RateValue>(null, response.provenance, response.reasons);
  const { data } = response.value;
  const reasons: ReasonCode[] = indexReasons(response.provenance.kind === "http" ? response.provenance.indexedBlock : null, options.reference);
  if (data.chain_id !== market.chainId || data.market_id.toLowerCase() !== market.marketId.toLowerCase()) reasons.push("identity_mismatch");
  const average = data.borrow_apy_averages[window];
  if (average === null) return observe<RateValue>(null, response.provenance, [...reasons, "unreadable"]);
  return observe<RateValue>(
    { kind: "market_borrow", value: wadOf(average), scale: WAD, convention: "apy-compounded", window: MARKET_WINDOWS[window] },
    response.provenance,
    reasons,
  );
}

/** Realized native vault APY over a named lookback. Excludes rewards; fee treatment is the provider's. */
export async function fetchVaultNativeApy(
  fetchFn: Fetch,
  vault: { chainId: number; vault: Address },
  lookback: VaultLookback,
  options: FetchOptions,
): Promise<Observation<RateValue>> {
  const response = await readJson(fetchFn, {
    url: `${MORPHO_API}/v1/vaults-v2/${vault.chainId}:${vault.vault}/apy-averages?lookback=${lookback}`,
    schema: vaultAverageSchema,
    now: options.now,
    indexedBlock: (body) => BigInt(body.data.last_indexed_block),
  });
  if (response.value === null) return observe<RateValue>(null, response.provenance, response.reasons);
  const { data } = response.value;
  const reasons: ReasonCode[] = indexReasons(response.provenance.kind === "http" ? response.provenance.indexedBlock : null, options.reference);
  if (data.chain_id !== vault.chainId || data.vault_address.toLowerCase() !== vault.vault.toLowerCase()) reasons.push("identity_mismatch");
  if (data.apy === null) return observe<RateValue>(null, response.provenance, [...reasons, "unreadable"]);
  // The window is the one the provider says it computed, never the one requested.
  return observe<RateValue>(
    { kind: "vault_native", value: wadOf(data.apy), scale: WAD, convention: "apy-compounded", window: VAULT_LOOKBACKS[data.lookback] },
    response.provenance,
    reasons,
  );
}

function incentivesOf(rewards: z.output<typeof rewardSchema>[], sides: ReadonlyArray<"borrow" | "supply">): Incentive[] {
  return rewards.flatMap((reward) =>
    sides.flatMap((side) => {
      const apr = side === "borrow" ? reward.borrowApr : reward.supplyApr;
      return apr === null || apr === undefined
        ? []
        : [{ token: getAddress(reward.asset.address), symbol: reward.asset.symbol, side, aprWad: wadOf(apr), convention: "apr-simple" as const }];
    }));
}

const GRAPHQL = `${MORPHO_API}/graphql`;
const VAULT_REWARDS_QUERY =
  "query VaultRewards($address: String!, $chainId: Int!) { vaultV2ByAddress(address: $address, chainId: $chainId) { address rewards { asset { address symbol decimals } supplyApr } } }";
const MARKET_REWARDS_QUERY =
  "query MarketRewards($marketId: String!, $chainId: Int!) { marketById(marketId: $marketId, chainId: $chainId) { marketId state { rewards { asset { address symbol decimals } borrowApr supplyApr } } } }";

function graphqlInit(query: string, variables: Record<string, unknown>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) };
}

/** Reward programs on the vault's supply side, by token. Indexed discovery data; never part of native APY. */
export async function fetchVaultIncentives(fetchFn: Fetch, vault: { chainId: number; vault: Address }, options: { now: () => Date }): Promise<Observation<Incentive[]>> {
  const response = await readJson(fetchFn, { url: GRAPHQL, init: graphqlInit(VAULT_REWARDS_QUERY, { address: vault.vault, chainId: vault.chainId }), schema: vaultRewardsSchema, now: options.now });
  if (response.value === null) return observe<Incentive[]>(null, response.provenance, response.reasons);
  const entity = response.value.data.vaultV2ByAddress;
  return observe(incentivesOf(entity.rewards, ["supply"]), response.provenance, entity.address.toLowerCase() === vault.vault.toLowerCase() ? [] : ["identity_mismatch"]);
}

/** Reward programs on the market, per side. A borrow-side reward never reduces the protocol borrow rate. */
export async function fetchMarketIncentives(fetchFn: Fetch, market: { chainId: number; marketId: Hex }, options: { now: () => Date }): Promise<Observation<Incentive[]>> {
  const response = await readJson(fetchFn, { url: GRAPHQL, init: graphqlInit(MARKET_REWARDS_QUERY, { marketId: market.marketId, chainId: market.chainId }), schema: marketRewardsSchema, now: options.now });
  if (response.value === null) return observe<Incentive[]>(null, response.provenance, response.reasons);
  const entity = response.value.data.marketById;
  return observe(incentivesOf(entity.state.rewards, ["borrow", "supply"]), response.provenance, entity.marketId.toLowerCase() === market.marketId.toLowerCase() ? [] : ["identity_mismatch"]);
}

/** The IRM's current per-second rate as a simple APR. Onchain, instant, and not an APY. */
export function instantBorrowRate(market: Observation<MarketSnapshot>): Observation<RateValue> {
  if (market.value === null) return observe<RateValue>(null, market.provenance, market.reasons);
  return observe<RateValue>(
    { kind: "market_borrow", value: market.value.instantBorrowRatePerSecondWad * SECONDS_PER_YEAR, scale: WAD, convention: "apr-simple", window: "instant" },
    market.provenance,
    market.reasons,
  );
}

/** Vault V2 fees read onchain: a performance fraction and an annualized management rate, never summed. */
export function vaultFees(vault: Observation<VaultSnapshot>): Observation<VaultFees> {
  if (vault.value === null) return observe<VaultFees>(null, vault.provenance, vault.reasons);
  const { performanceFeeWad, managementFeePerSecondWad } = vault.value.fees;
  return observe({ performanceFeeWad, managementFeeAprWad: managementFeePerSecondWad * SECONDS_PER_YEAR }, vault.provenance, vault.reasons);
}

/**
 * Everything that stops two rates from being netted against each other. An empty list means the two may be
 * compared; any entry means a spread computed from them would be meaningless.
 */
export function comparability(left: Observation<RateValue>, right: Observation<RateValue>): ReasonCode[] {
  const reasons: ReasonCode[] = [...left.reasons, ...right.reasons];
  if (left.value !== null && right.value !== null) {
    if (left.value.convention !== right.value.convention) reasons.push("convention_mismatch");
    if (left.value.window !== right.value.window) reasons.push("window_mismatch");
  }
  return reasons.filter((reason, index) => reasons.indexOf(reason) === index);
}
