import { keccak256, parseAbi } from "viem";
import type { Address, Hex, PublicClient } from "viem";

import { observe } from "@crest/domain";
import type { BlockRef, Observation, ReasonCode } from "@crest/domain";

import { readProvenance } from "./client.ts";

export const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/** Morpho `IOracle`: collateral price quoted in loan token, scaled by 1e36 adjusted for both token decimals. */
export const MORPHO_ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);

/**
 * Exact read-only Crest Account and ERC-20 selectors used by the canonical monitor snapshot.
 *
 * `policy()` is the Solidity `CrestAccount.PolicyConfig` tuple, including its nested Morpho `MarketParams`.
 */
export const CREST_ACCOUNT_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct PolicyConfig { MarketParams market; address yieldVault; uint128 maxCollateralAssets; uint128 debtCeilingAssets; uint128 maxStrategyAssets; uint128 reserveFloorAssets; uint128 strategyFloorAssets; uint128 maxRepayPerActionAssets; uint64 lowerLtvWad; uint64 targetLtvWad; uint64 upperLtvWad; uint64 criticalLtvWad; address guardian; }",
  "function policy() view returns (PolicyConfig)",
  "function policyNonce() view returns (uint64)",
  "function borrowingFrozen() view returns (bool)",
  "function owner() view returns (address)",
  "function guardian() view returns (address)",
  "function marketId() view returns (bytes32)",
  "function balanceOf(address account) view returns (uint256)",
]);

export interface CrestMarketParams {
  loanToken: Address;
  collateralToken: Address;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

/**
 * Lossless typed form of `CrestAccount.PolicyConfig`, enriched with the separately-read owner and stored market
 * ID. `guardian` is read both here and through its public getter, then checked for consistency.
 */
export interface CrestAccountPolicy {
  market: CrestMarketParams;
  yieldVault: Address;
  maxCollateralAssets: bigint;
  debtCeilingAssets: bigint;
  maxStrategyAssets: bigint;
  reserveFloorAssets: bigint;
  strategyFloorAssets: bigint;
  maxRepayPerActionAssets: bigint;
  lowerLtvWad: bigint;
  targetLtvWad: bigint;
  upperLtvWad: bigint;
  criticalLtvWad: bigint;
  guardian: Address;
  owner: Address;
  marketId: Hex;
}

/**
 * Canonical Crest Account facts at one pinned block. The monitor can map the first four fields directly to
 * `@crest/risk`'s `AccountState`; `policy` retains the exact authority and route facts for persistence.
 */
export interface CrestAccountSnapshot {
  account: Address;
  borrowingFrozen: boolean;
  policyNonce: bigint;
  idleReserveAssets: bigint;
  policy: CrestAccountPolicy;
}

/**
 * Reads Crest Account configuration and its loan-token reserve concurrently, all against `block.number`.
 *
 * A failed read returns `observe(null, readProvenance(client, block))`; a loan-token or Guardian mismatch preserves the
 * evidence as an `identity_mismatch` rather than appearing normal.
 */
export async function readCrestAccount(
  client: PublicClient,
  block: BlockRef,
  account: Address,
  loanToken: Address,
): Promise<Observation<CrestAccountSnapshot>> {
  const provenance = readProvenance(client, block);
  try {
    const [rawPolicy, policyNonce, borrowingFrozen, owner, guardian, marketId, idleReserveAssets] = await Promise.all([
      client.readContract({ address: account, abi: CREST_ACCOUNT_ABI, functionName: "policy", blockNumber: block.number }),
      client.readContract({ address: account, abi: CREST_ACCOUNT_ABI, functionName: "policyNonce", blockNumber: block.number }),
      client.readContract({ address: account, abi: CREST_ACCOUNT_ABI, functionName: "borrowingFrozen", blockNumber: block.number }),
      client.readContract({ address: account, abi: CREST_ACCOUNT_ABI, functionName: "owner", blockNumber: block.number }),
      client.readContract({ address: account, abi: CREST_ACCOUNT_ABI, functionName: "guardian", blockNumber: block.number }),
      client.readContract({ address: account, abi: CREST_ACCOUNT_ABI, functionName: "marketId", blockNumber: block.number }),
      client.readContract({ address: loanToken, abi: CREST_ACCOUNT_ABI, functionName: "balanceOf", args: [account], blockNumber: block.number }),
    ]);
    const policy: CrestAccountPolicy = {
      market: rawPolicy.market,
      yieldVault: rawPolicy.yieldVault,
      maxCollateralAssets: rawPolicy.maxCollateralAssets,
      debtCeilingAssets: rawPolicy.debtCeilingAssets,
      maxStrategyAssets: rawPolicy.maxStrategyAssets,
      reserveFloorAssets: rawPolicy.reserveFloorAssets,
      strategyFloorAssets: rawPolicy.strategyFloorAssets,
      maxRepayPerActionAssets: rawPolicy.maxRepayPerActionAssets,
      lowerLtvWad: rawPolicy.lowerLtvWad,
      targetLtvWad: rawPolicy.targetLtvWad,
      upperLtvWad: rawPolicy.upperLtvWad,
      criticalLtvWad: rawPolicy.criticalLtvWad,
      guardian: rawPolicy.guardian,
      owner,
      marketId,
    };
    const reasons: ReasonCode[] = [];
    if (policy.market.loanToken.toLowerCase() !== loanToken.toLowerCase() || policy.guardian.toLowerCase() !== guardian.toLowerCase()) {
      reasons.push("identity_mismatch");
    }
    return observe({ account, borrowingFrozen, policyNonce, idleReserveAssets, policy }, provenance, reasons);
  } catch {
    return observe<CrestAccountSnapshot>(null, provenance);
  }
}

export interface FeedRound {
  feed: Address;
  roundId: bigint;
  answer: bigint;
  decimals: number;
  updatedAt: bigint;
  /** Pinned block timestamp minus `updatedAt`. */
  ageSeconds: bigint;
}

/**
 * Reads one Chainlink round at the pinned block.
 *
 * `maxAgeSeconds` is the caller's staleness bound, normally the feed heartbeat. Robinhood tokenized-equity feeds
 * stop publishing off-hours, so a weekend read is correctly stale: that restricts, it never prices at zero.
 */
export async function readFeed(client: PublicClient, block: BlockRef, feed: Address, maxAgeSeconds: bigint): Promise<Observation<FeedRound>> {
  const provenance = readProvenance(client, block);
  let round: readonly [bigint, bigint, bigint, bigint, bigint];
  let decimals: number;
  try {
    [round, decimals] = await Promise.all([
      client.readContract({ address: feed, abi: FEED_ABI, functionName: "latestRoundData", blockNumber: block.number }),
      client.readContract({ address: feed, abi: FEED_ABI, functionName: "decimals", blockNumber: block.number }),
    ]);
  } catch {
    return observe<FeedRound>(null, provenance);
  }
  const [roundId, answer, , updatedAt] = round;
  const ageSeconds = block.timestamp > updatedAt ? block.timestamp - updatedAt : 0n;
  const reasons: ReasonCode[] = [];
  if (answer <= 0n || updatedAt === 0n) reasons.push("oracle_invalid");
  if (ageSeconds > maxAgeSeconds) reasons.push("stale");
  return observe({ feed, roundId, answer, decimals, updatedAt, ageSeconds }, provenance, reasons);
}

/** The exact Morpho market oracle answer. This, and only this, is Morpho's collateral valuation authority. */
export async function readMarketOraclePrice(client: PublicClient, block: BlockRef, oracle: Address): Promise<Observation<bigint>> {
  const provenance = readProvenance(client, block);
  try {
    const price = await client.readContract({ address: oracle, abi: MORPHO_ORACLE_ABI, functionName: "price", blockNumber: block.number });
    return observe(price, provenance, price === 0n ? ["oracle_invalid"] : []);
  } catch {
    return observe<bigint>(null, provenance);
  }
}

/** Reads deployed bytecode at the pinned block and compares its hash with the reviewed one. */
export async function readCodeHash(client: PublicClient, block: BlockRef, address: Address, expected: Hex): Promise<Observation<Hex>> {
  const provenance = readProvenance(client, block);
  const code = await client.getCode({ address, blockNumber: block.number }).catch(() => undefined);
  if (code === undefined || code === "0x") return observe<Hex>(null, provenance);
  const hash = keccak256(code);
  return observe(hash, provenance, hash.toLowerCase() === expected.toLowerCase() ? [] : ["identity_mismatch"]);
}

export type SimulationResult = { ok: true; returnData: Hex } | { ok: false; revert: string };

/**
 * Executes one exact call at the pinned block without sending anything. A revert is evidence, so it is kept
 * in the value and marked, never swallowed into an empty result.
 */
export async function simulateCall(
  client: PublicClient,
  block: BlockRef,
  request: { from: Address; to: Address; data: Hex },
): Promise<Observation<SimulationResult>> {
  const provenance = readProvenance(client, block);
  try {
    const { data } = await client.call({ account: request.from, to: request.to, data: request.data, blockNumber: block.number });
    return observe<SimulationResult>({ ok: true, returnData: data ?? "0x" }, provenance);
  } catch (error) {
    const revert = error instanceof Error ? error.message : String(error);
    return observe<SimulationResult>({ ok: false, revert }, provenance, ["simulation_reverted"]);
  }
}
