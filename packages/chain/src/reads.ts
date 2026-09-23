import { keccak256, parseAbi } from "viem";
import type { Address, Hex, PublicClient } from "viem";

import { observe } from "@crest/domain";
import type { BlockRef, Observation, ReasonCode } from "@crest/domain";

import { onchainAt } from "./client.ts";

export const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

/** Morpho `IOracle`: collateral price quoted in loan token, scaled by 1e36 adjusted for both token decimals. */
export const MORPHO_ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);

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
  const provenance = onchainAt(block);
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
  const provenance = onchainAt(block);
  try {
    const price = await client.readContract({ address: oracle, abi: MORPHO_ORACLE_ABI, functionName: "price", blockNumber: block.number });
    return observe(price, provenance, price === 0n ? ["oracle_invalid"] : []);
  } catch {
    return observe<bigint>(null, provenance);
  }
}

/** Reads deployed bytecode at the pinned block and compares its hash with the reviewed one. */
export async function readCodeHash(client: PublicClient, block: BlockRef, address: Address, expected: Hex): Promise<Observation<Hex>> {
  const provenance = onchainAt(block);
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
  const provenance = onchainAt(block);
  try {
    const { data } = await client.call({ account: request.from, to: request.to, data: request.data, blockNumber: block.number });
    return observe<SimulationResult>({ ok: true, returnData: data ?? "0x" }, provenance);
  } catch (error) {
    const revert = error instanceof Error ? error.message : String(error);
    return observe<SimulationResult>({ ok: false, revert }, provenance, ["simulation_reverted"]);
  }
}
