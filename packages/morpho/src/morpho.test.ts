import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { fakeChain } from "@crest/chain/testing";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";

import { accrueInterest, ERC20_BALANCE_ABI, IRM_ABI, MORPHO_ABI, marketIdOf, morphoRouteOf, readMarket, readPosition, toAssetsUp } from "./index.ts";
import type { MarketParams, MarketState, MorphoRoute } from "./index.ts";

// Every vector below is live Robinhood Chain state read at block 70212238 (timestamp 1790136140).
const block = { number: 70_212_238n, hash: "0x8cca2e79abb41ef412feb8fabf22d6d57a48a68e3a19a5fec49f73beb6e2f893", timestamp: 1_790_136_140n } as const;
const params: MarketParams = {
  loanToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  collateralToken: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  oracle: "0xD625d488D552775D2867194C618B945E5dDfE097",
  irm: "0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1",
  lltv: 625_000_000_000_000_000n,
};
const route: MorphoRoute = {
  morpho: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010",
  marketId: "0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45",
  params,
};
const stored: MarketState = {
  totalSupplyAssets: 239_059_356_821n,
  totalSupplyShares: 238_805_362_585_313_912n,
  totalBorrowAssets: 101_129_325n,
  totalBorrowShares: 100_999_662_445_570n,
  lastUpdate: 1_790_091_680n,
  fee: 0n,
};
const storedTuple = [stored.totalSupplyAssets, stored.totalSupplyShares, stored.totalBorrowAssets, stored.totalBorrowShares, stored.lastUpdate, stored.fee];
const ACCRUAL_RATE = 174_017_581n;
const INSTANT_RATE = 180_198_025n;
const MORPHO_LOAN_BALANCE = 53_503_566_937_485n;

function liveMarket(overrides: { params?: MarketParams; morphoLoanBalance?: bigint } = {}) {
  const onchainParams = overrides.params ?? params;
  return fakeChain({
    block,
    calls: [
      { address: route.morpho, abi: MORPHO_ABI, functionName: "market", args: [route.marketId], result: storedTuple },
      {
        address: route.morpho,
        abi: MORPHO_ABI,
        functionName: "idToMarketParams",
        args: [route.marketId],
        result: [onchainParams.loanToken, onchainParams.collateralToken, onchainParams.oracle, onchainParams.irm, onchainParams.lltv],
      },
      { address: params.irm, abi: IRM_ABI, functionName: "borrowRateView", args: [params, stored], result: ACCRUAL_RATE },
      {
        address: params.irm,
        abi: IRM_ABI,
        functionName: "borrowRateView",
        args: [params, { ...stored, lastUpdate: block.timestamp }],
        result: INSTANT_RATE,
      },
      {
        address: params.loanToken,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [route.morpho],
        result: overrides.morphoLoanBalance ?? MORPHO_LOAN_BALANCE,
      },
    ],
  });
}

describe("market identity", () => {
  test("recomputes the reviewed market id from all five parameters", () => {
    expect(marketIdOf(params)).toBe(route.marketId);
    expect(marketIdOf({ ...params, lltv: 860_000_000_000_000_000n })).not.toBe(route.marketId);
  });

  test("binds the reviewed manifest to a self-consistent, checksum-valid route", async () => {
    const bound = morphoRouteOf(await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url))));
    expect(bound).toEqual(route);
    expect(marketIdOf(bound.params)).toBe(bound.marketId);
  });
});

describe("interest accrual mirrors MorphoBalancesLib", () => {
  test("accrues borrow and supply by the same interest over the elapsed time", () => {
    const accrued = accrueInterest(stored, ACCRUAL_RATE, block.timestamp);
    expect(accrued.totalBorrowAssets).toBe(101_130_107n);
    expect(accrued.totalSupplyAssets).toBe(239_059_357_603n);
    expect(accrued.totalSupplyShares).toBe(stored.totalSupplyShares);
    expect(accrued.lastUpdate).toBe(block.timestamp);
  });

  test("mints fee shares to the fee recipient when the market charges a fee", () => {
    const accrued = accrueInterest({ ...stored, fee: 100_000_000_000_000_000n }, ACCRUAL_RATE, block.timestamp);
    expect(accrued.totalSupplyShares).toBe(238_805_362_663_231_038n);
  });

  test("does nothing when no time has passed or nothing is borrowed", () => {
    expect(accrueInterest(stored, ACCRUAL_RATE, stored.lastUpdate)).toEqual(stored);
    const idle = { ...stored, totalBorrowAssets: 0n, totalBorrowShares: 0n };
    expect(accrueInterest(idle, ACCRUAL_RATE, block.timestamp)).toEqual({ ...idle, lastUpdate: block.timestamp });
  });

  test("debt rounds up so Crest never under-reports what it owes", () => {
    expect(toAssetsUp(1_000_000_000_000n, 101_130_107n, stored.totalBorrowShares)).toBe(1_001_292n);
  });
});

describe("readMarket", () => {
  test("returns accrued state, both IRM rates, and liquidity at one block", async () => {
    const market = await readMarket(liveMarket(), block, route);
    expect(market.status).toBe("normal");
    expect(market.provenance).toEqual({ kind: "onchain", chainId: 4663, block });
    expect(market.value).toMatchObject({
      stored,
      accrued: { totalBorrowAssets: 101_130_107n, totalSupplyAssets: 239_059_357_603n },
      accrualBorrowRatePerSecondWad: ACCRUAL_RATE,
      instantBorrowRatePerSecondWad: INSTANT_RATE,
      liquidityAssets: 239_059_357_603n - 101_130_107n,
    });
  });

  test("liquidity never exceeds the loan tokens Morpho actually holds", async () => {
    const market = await readMarket(liveMarket({ morphoLoanBalance: 5n }), block, route);
    expect(market.value?.liquidityAssets).toBe(5n);
  });

  test("a market whose onchain parameters differ from the reviewed route is an identity mismatch", async () => {
    const market = await readMarket(liveMarket({ params: { ...params, oracle: "0x0000000000000000000000000000000000000bad" } }), block, route);
    expect(market).toMatchObject({ status: "degraded", reasons: ["identity_mismatch"] });
  });

  test("an unreadable market is unknown, not an empty market", async () => {
    const market = await readMarket(fakeChain({ block }), block, route);
    expect(market).toMatchObject({ status: "unknown", value: null });
  });
});

describe("readPosition", () => {
  test("reports accrued debt rounded up against the same block's market", async () => {
    const account = "0x00000000000000000000000000000000000000c1";
    const client = fakeChain({
      block,
      calls: [{ address: route.morpho, abi: MORPHO_ABI, functionName: "position", args: [route.marketId, account], result: [0n, 1_000_000_000_000n, 7n] }],
    });
    const market = await readMarket(liveMarket(), block, route);
    if (market.value === null) throw new Error("market fixture unreadable");
    const position = await readPosition(client, block, route, market.value, account);
    expect(position.status).toBe("normal");
    expect(position.value).toEqual({ account, supplyShares: 0n, borrowShares: 1_000_000_000_000n, collateralAssets: 7n, debtAssets: 1_001_292n });
  });
});
