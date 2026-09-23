import { parseAbi } from "viem";
import type { Address, Hex, PublicClient } from "viem";

import { onchainAt } from "@crest/chain";
import { observe } from "@crest/domain";
import type { BlockRef, Observation, ReasonCode } from "@crest/domain";

/** ERC-8056 Scaled UI Amount surface plus Robinhood's uid and advisory oracle-pause flag. */
export const STOCK_TOKEN_ABI = parseAbi([
  "function uid() view returns (bytes32)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function oraclePaused() view returns (bool)",
  "function decimals() view returns (uint8)",
]);

export interface StockTokenState {
  uid: Hex;
  /** Shares per token, 18 decimals. Already inside the Chainlink token price; never apply it to that price. */
  uiMultiplierWad: bigint;
  newUIMultiplierWad: bigint;
  effectiveAt: bigint;
  /** Advisory only: `false` never replaces feed freshness checks, `true` means degraded, not price zero. */
  oraclePaused: boolean;
  decimals: number;
}

/** Canonical Stock Token lifecycle state at the pinned block. */
export async function readStockToken(client: PublicClient, block: BlockRef, token: Address): Promise<Observation<StockTokenState>> {
  const provenance = onchainAt(block);
  const at = { address: token, abi: STOCK_TOKEN_ABI, blockNumber: block.number } as const;
  try {
    const [uid, uiMultiplierWad, newUIMultiplierWad, effectiveAt, oraclePaused, decimals] = await Promise.all([
      client.readContract({ ...at, functionName: "uid" }),
      client.readContract({ ...at, functionName: "uiMultiplier" }),
      client.readContract({ ...at, functionName: "newUIMultiplier" }),
      client.readContract({ ...at, functionName: "effectiveAt" }),
      client.readContract({ ...at, functionName: "oraclePaused" }),
      client.readContract({ ...at, functionName: "decimals" }),
    ]);
    const reasons: ReasonCode[] = [];
    if (newUIMultiplierWad !== uiMultiplierWad && effectiveAt > block.timestamp) reasons.push("multiplier_pending");
    if (oraclePaused) reasons.push("oracle_paused");
    return observe({ uid, uiMultiplierWad, newUIMultiplierWad, effectiveAt, oraclePaused, decimals }, provenance, reasons);
  } catch {
    return observe<StockTokenState>(null, provenance);
  }
}
