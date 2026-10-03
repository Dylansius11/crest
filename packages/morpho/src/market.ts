import { encodeAbiParameters, keccak256, parseAbi } from "viem";
import type { Address, Hex, PublicClient } from "viem";

import { readProvenance } from "@crest/chain";
import { observe } from "@crest/domain";
import type { BlockRef, Observation, ReasonCode } from "@crest/domain";


import { accrueInterest, toAssetsUp } from "./math.ts";
import type { MarketState } from "./math.ts";


export const MORPHO_ABI = parseAbi([
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

export const IRM_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct Market { uint128 totalSupplyAssets; uint128 totalSupplyShares; uint128 totalBorrowAssets; uint128 totalBorrowShares; uint128 lastUpdate; uint128 fee; }",
  "function borrowRateView(MarketParams marketParams, Market market) view returns (uint256)",
]);

export const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export interface MarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

/** The one reviewed Morpho market Crest may use. */
export interface MorphoRoute {
  morpho: Address;
  marketId: Hex;
  params: MarketParams;
}

export interface MarketSnapshot {
  id: Hex;
  params: MarketParams;
  /** Totals exactly as stored at the market's last interaction. */
  stored: MarketState;
  /** Totals Morpho would hold after accruing to the pinned block timestamp. */
  accrued: MarketState;
  /** IRM rate applied over the unaccrued interval; the one that produced `accrued`. */
  accrualBorrowRatePerSecondWad: bigint;
  /** IRM rate at the pinned block's utilization, with no elapsed drift: the current variable borrow rate. */
  instantBorrowRatePerSecondWad: bigint;
  /** Borrowable now: accrued supply minus accrued borrow, never more than the loan tokens Morpho holds. */
  liquidityAssets: bigint;
}

export interface PositionSnapshot {
  account: Address;
  supplyShares: bigint;
  borrowShares: bigint;
  collateralAssets: bigint;
  /** Accrued debt at the pinned block, rounded up the way Morpho charges it. */
  debtAssets: bigint;
}

/** `MarketParamsLib.id`: keccak256 of the ABI-encoded five-field tuple. */
export function marketIdOf(params: MarketParams): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv],
    ),
  );
}

function sameParams(left: MarketParams, right: MarketParams): boolean {
  return left.loanToken.toLowerCase() === right.loanToken.toLowerCase()
    && left.collateralToken.toLowerCase() === right.collateralToken.toLowerCase()
    && left.oracle.toLowerCase() === right.oracle.toLowerCase()
    && left.irm.toLowerCase() === right.irm.toLowerCase()
    && left.lltv === right.lltv;
}

/**
 * Reads the reviewed market at one block and accrues it exactly as Morpho would.
 *
 * Identity is re-proven on every read: the id must derive from the reviewed parameters and Morpho must map it
 * to those same parameters. Any difference marks the whole snapshot, because a different market's numbers
 * cannot describe this account's risk.
 */
export async function readMarket(client: PublicClient, block: BlockRef, route: MorphoRoute): Promise<Observation<MarketSnapshot>> {
  const provenance = readProvenance(client, block);
  const at = { blockNumber: block.number };
  let stored: MarketState;
  let onchainParams: MarketParams;
  let morphoLoanBalance: bigint;
  try {
    const [market, idParams, balance] = await Promise.all([
      client.readContract({ address: route.morpho, abi: MORPHO_ABI, functionName: "market", args: [route.marketId], ...at }),
      client.readContract({ address: route.morpho, abi: MORPHO_ABI, functionName: "idToMarketParams", args: [route.marketId], ...at }),
      client.readContract({ address: route.params.loanToken, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [route.morpho], ...at }),
    ]);
    const [totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee] = market;
    stored = { totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate, fee };
    const [loanToken, collateralToken, oracle, irm, lltv] = idParams;
    onchainParams = { loanToken, collateralToken, oracle, irm, lltv };
    morphoLoanBalance = balance;
  } catch {
    return observe<MarketSnapshot>(null, provenance);
  }
  // A market Morpho never created has lastUpdate zero; its empty totals are not a market.
  if (stored.lastUpdate === 0n) return observe<MarketSnapshot>(null, provenance, ["identity_mismatch"]);

  const reasons: ReasonCode[] = [];
  if (marketIdOf(route.params) !== route.marketId.toLowerCase() || !sameParams(onchainParams, route.params)) reasons.push("identity_mismatch");

  let accrualBorrowRatePerSecondWad: bigint;
  let instantBorrowRatePerSecondWad: bigint;
  try {
    [accrualBorrowRatePerSecondWad, instantBorrowRatePerSecondWad] = await Promise.all([
      client.readContract({ address: route.params.irm, abi: IRM_ABI, functionName: "borrowRateView", args: [route.params, stored], ...at }),
      client.readContract({
        address: route.params.irm,
        abi: IRM_ABI,
        functionName: "borrowRateView",
        args: [route.params, { ...stored, lastUpdate: block.timestamp }],
        ...at,
      }),
    ]);
  } catch {
    return observe<MarketSnapshot>(null, provenance, [...reasons, "unreadable"]);
  }

  const accrued = accrueInterest(stored, accrualBorrowRatePerSecondWad, block.timestamp);
  const free = accrued.totalSupplyAssets - accrued.totalBorrowAssets;
  return observe(
    {
      id: route.marketId,
      params: onchainParams,
      stored,
      accrued,
      accrualBorrowRatePerSecondWad,
      instantBorrowRatePerSecondWad,
      liquidityAssets: free < morphoLoanBalance ? free : morphoLoanBalance,
    },
    provenance,
    reasons,
  );
}

/**
 * Reads one account's position against a market snapshot taken at the same block. Debt uses the snapshot's
 * accrued totals, so it matches what `repay` would have to cover at that block.
 */
export async function readPosition(
  client: PublicClient,
  block: BlockRef,
  route: MorphoRoute,
  market: MarketSnapshot,
  account: Address,
): Promise<Observation<PositionSnapshot>> {
  const provenance = readProvenance(client, block);
  try {
    const [supplyShares, borrowShares, collateralAssets] = await client.readContract({
      address: route.morpho,
      abi: MORPHO_ABI,
      functionName: "position",
      args: [route.marketId, account],
      blockNumber: block.number,
    });
    const debtAssets = toAssetsUp(borrowShares, market.accrued.totalBorrowAssets, market.accrued.totalBorrowShares);
    return observe({ account, supplyShares, borrowShares, collateralAssets, debtAssets }, provenance);
  } catch {
    return observe<PositionSnapshot>(null, provenance);
  }
}
