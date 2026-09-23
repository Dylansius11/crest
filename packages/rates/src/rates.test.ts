import { getAddress } from "viem";
import { describe, expect, test } from "vitest";

import { observe } from "@crest/domain";
import type { Fetch, Observation } from "@crest/domain";
import type { MarketSnapshot } from "@crest/morpho";
import type { VaultSnapshot } from "@crest/vault";

import graphqlMarketRewards from "./fixtures/graphql-market-rewards.json" with { type: "json" };
import graphqlVaultRewards from "./fixtures/graphql-vault-rewards.json" with { type: "json" };
import marketApyAverages from "./fixtures/market-apy-averages.json" with { type: "json" };
import vaultOneDay from "./fixtures/vault-apy-averages-one-day.json" with { type: "json" };
import vaultSixHours from "./fixtures/vault-apy-averages-six-hours.json" with { type: "json" };
import {
  comparability,
  fetchMarketBorrowApy,
  fetchMarketIncentives,
  fetchVaultIncentives,
  fetchVaultNativeApy,
  instantBorrowRate,
  vaultFees,
} from "./index.ts";

const MARKET = { chainId: 4663, marketId: "0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45" } as const;
const VAULT = { chainId: 4663, vault: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd" } as const;
const now = () => new Date("2026-09-23T03:58:56Z");
// Pinned chain head the indexed rates are judged against, and the allowed indexer lag.
const reference = { headBlock: 70_210_500n, maxIndexLagBlocks: 1_200n };

/** Serves recorded provider responses, and only them, keyed by exact URL. */
function replay(...recordings: Array<{ recordedFrom: string; body: unknown; status?: number }>): Fetch {
  return async (url) => {
    const recording = recordings.find((entry) => entry.recordedFrom === url);
    if (recording === undefined) return new Response("not recorded", { status: 404 });
    return new Response(JSON.stringify(recording.body), { status: recording.status ?? 200 });
  };
}

describe("Morpho REST rate averages", () => {
  test("the market borrow average keeps its value, window, convention, and indexed block", async () => {
    const rate = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "24h", { now, reference });
    expect(rate.status).toBe("normal");
    // 0.0057406736830905025 as sent, truncated at 18 decimals.
    expect(rate.value).toEqual({ kind: "market_borrow", value: 5_740_673_683_090_502n, scale: 10n ** 18n, convention: "apy-compounded", window: "P1D" });
    expect(rate.provenance).toMatchObject({ kind: "http", url: marketApyAverages.recordedFrom, indexedBlock: 70_210_196n, generatedAt: null });
  });

  test("an average the provider has not computed yet is unknown, never zero", async () => {
    const rate = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "30d", { now, reference });
    expect(rate).toMatchObject({ status: "unknown", value: null });
  });

  test("an indexer that lags the pinned head beyond budget is stale", async () => {
    const rate = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "24h", { now, reference: { headBlock: 70_220_000n, maxIndexLagBlocks: 1_200n } });
    expect(rate).toMatchObject({ status: "degraded", reasons: ["stale"] });
  });

  test("a payload that breaks the provider contract is invalid, and an HTTP failure is unreadable", async () => {
    const broken = { ...marketApyAverages, body: { data: { ...marketApyAverages.body.data, borrow_apy_averages: { "24h": "high" } } } };
    expect((await fetchMarketBorrowApy(replay(broken), MARKET, "24h", { now, reference })).reasons).toEqual(["invalid_response"]);
    expect((await fetchMarketBorrowApy(replay({ ...marketApyAverages, status: 503 }), MARKET, "24h", { now, reference })).reasons).toEqual(["unreadable"]);
  });

  test("a response for a different market is an identity mismatch", async () => {
    const other = { ...marketApyAverages, body: { data: { ...marketApyAverages.body.data, market_id: `0x${"11".repeat(32)}` } } };
    expect((await fetchMarketBorrowApy(replay(other), MARKET, "24h", { now, reference })).reasons).toContain("identity_mismatch");
  });

  test("the vault native average reports the window the provider actually computed", async () => {
    const sixHours = await fetchVaultNativeApy(replay(vaultSixHours), VAULT, "six_hours", { now, reference });
    expect(sixHours.value).toMatchObject({ kind: "vault_native", value: 40_494_764_240_493_364n, window: "PT6H", convention: "apy-compounded" });
  });
});

describe("comparability", () => {
  test("a six-hour vault average cannot be netted against a one-day borrow average", async () => {
    const borrow = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "24h", { now, reference });
    const vault = await fetchVaultNativeApy(replay(vaultSixHours), VAULT, "six_hours", { now, reference });
    expect(comparability(vault, borrow)).toEqual(["window_mismatch"]);
  });

  test("matching windows and conventions are comparable", async () => {
    const borrow = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "24h", { now, reference: { headBlock: 70_214_579n, maxIndexLagBlocks: 5_000n } });
    const vault = await fetchVaultNativeApy(replay(vaultOneDay), VAULT, "one_day", { now, reference: { headBlock: 70_214_579n, maxIndexLagBlocks: 5_000n } });
    expect(comparability(vault, borrow)).toEqual([]);
  });

  test("an instant onchain APR is neither the same convention nor the same window as an averaged APY", async () => {
    const borrow = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "24h", { now, reference });
    const instant = instantBorrowRate(onchainMarket(180_198_025n));
    expect(comparability(instant, borrow)).toEqual(["convention_mismatch", "window_mismatch"]);
  });

  test("a degraded input carries its reasons into the comparison", async () => {
    const stale = await fetchMarketBorrowApy(replay(marketApyAverages), MARKET, "24h", { now, reference: { headBlock: 80_000_000n, maxIndexLagBlocks: 1n } });
    const vault = await fetchVaultNativeApy(replay(vaultOneDay), VAULT, "one_day", { now, reference: { headBlock: 70_214_579n, maxIndexLagBlocks: 5_000n } });
    expect(comparability(vault, stale)).toEqual(["stale"]);
  });
});

const block = { number: 70_212_238n, hash: `0x${"ab".repeat(32)}`, timestamp: 1_790_136_140n } as const;
const onchain = { kind: "onchain", chainId: 4663, block } as const;

function onchainMarket(instantBorrowRatePerSecondWad: bigint): Observation<MarketSnapshot> {
  return observe({ instantBorrowRatePerSecondWad } as MarketSnapshot, onchain);
}

describe("onchain rates and fees", () => {
  test("the IRM per-second rate annualizes as a simple APR, labelled instant", () => {
    const rate = instantBorrowRate(onchainMarket(180_198_025n));
    expect(rate.value).toEqual({ kind: "market_borrow", value: 180_198_025n * 31_536_000n, scale: 10n ** 18n, convention: "apr-simple", window: "instant" });
    expect(rate.provenance).toEqual(onchain);
  });

  test("vault fees stay two separate components, each on its own basis", () => {
    const fees = vaultFees(observe({ fees: { performanceFeeWad: 100_000_000_000_000_000n, managementFeePerSecondWad: 1_585_489_599n } } as VaultSnapshot, onchain));
    expect(fees.value).toEqual({ performanceFeeWad: 100_000_000_000_000_000n, managementFeeAprWad: 1_585_489_599n * 31_536_000n });
  });
});

describe("incentives", () => {
  test("no reward programs is an explicit empty list, not an absent one", async () => {
    const vault = await fetchVaultIncentives(replay(graphqlVaultRewards), VAULT, { now });
    const market = await fetchMarketIncentives(replay(graphqlMarketRewards), MARKET, { now });
    expect(vault).toMatchObject({ status: "normal", value: [] });
    expect(market).toMatchObject({ status: "normal", value: [] });
  });

  test("each reward keeps its token and side and is never added to the protocol rate", async () => {
    const reward = { asset: { address: "0x0000000000000000000000000000000000000abc", symbol: "RWD", decimals: 18 }, borrowApr: 0.0125, supplyApr: null };
    const withReward = { ...graphqlMarketRewards, body: { data: { marketById: { ...graphqlMarketRewards.body.data.marketById, state: { rewards: [reward] } } } } };
    const market = await fetchMarketIncentives(replay(withReward), MARKET, { now });
    expect(market.value).toEqual([{ token: getAddress(reward.asset.address), symbol: "RWD", side: "borrow", aprWad: 12_500_000_000_000_000n, convention: "apr-simple" }]);
  });

  test("a GraphQL error payload is invalid, not an empty reward list", async () => {
    const errored = { ...graphqlVaultRewards, body: { errors: [{ message: "Cannot query field" }] } };
    expect((await fetchVaultIncentives(replay(errored), VAULT, { now })).reasons).toEqual(["invalid_response"]);
  });
});
