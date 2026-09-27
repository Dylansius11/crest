import { z } from "zod";

import type { EvidenceStatus } from "./risk.ts";

/**
 * The attribution envelope every adapter returns.
 *
 * An observation carries its value, the exact source it came from, and every reason it cannot be trusted as
 * normal. Status is derived from those facts, never supplied by the caller, so a degraded input cannot be
 * relabelled normal on its way to the risk engine. Reasons only ever tighten behaviour downstream.
 */

export const reasonCodeSchema = z.enum([
  /** The source did not answer, or the answer could not be decoded. */
  "unreadable",
  /** The source answered, but the payload failed schema validation. */
  "invalid_response",
  /** Older than the freshness budget the caller declared for this fact. */
  "stale",
  /** Two independent sources disagree on the same fact. */
  "conflict",
  /** Chain, address, bytecode, market, asset, or token identity differs from the reviewed route. */
  "identity_mismatch",
  /** The fixed vault liquidity route no longer matches the one the account was deployed against. */
  "route_drift",
  /** A price feed returned a non-positive answer or an incomplete round. */
  "oracle_invalid",
  /** The Stock Token advisory `oraclePaused()` flag is set. */
  "oracle_paused",
  /** The chain head is older than budget. Robinhood Chain has no Chainlink sequencer uptime feed. */
  "head_lag",
  /** Onchain inputs to one assessment were read at different blocks, so they do not describe one state. */
  "block_skew",
  /** Morpho's market oracle and Crest's feed-only price differ beyond policy, or the gap has no known cause. */
  "oracle_divergence",
  /** Robinhood reports an active trading halt on the underlying equity. */
  "trading_halt",
  /** A multiplier change is scheduled but not yet effective. */
  "multiplier_pending",
  /** A corporate action for this exact token is still being processed. */
  "corporate_action_in_progress",
  /** Robinhood reports the asset as not active. */
  "asset_inactive",
  /** Two rates use different compounding conventions and cannot be compared. */
  "convention_mismatch",
  /** Two rates cover different time windows and cannot be compared. */
  "window_mismatch",
  /** The vault share price fell below the reviewed baseline. */
  "vault_loss",
  /** A vault gate refuses this account's shares or assets. */
  "withdrawal_gated",
  /** The requested withdrawal exceeds what is currently withdrawable. */
  "withdrawal_constrained",
  /** The exact call reverted in simulation. */
  "simulation_reverted",
]);

export type ReasonCode = z.output<typeof reasonCodeSchema>;

export type Hex = `0x${string}`;

export interface BlockRef {
  number: bigint;
  hash: Hex;
  /** Unix seconds from the block header. Onchain freshness is always judged against this, not the wall clock. */
  timestamp: bigint;
}

export type Provenance =
  | { kind: "onchain"; chainId: number; block: BlockRef }
  | {
    kind: "http";
    url: string;
    /** When Crest received the response. */
    fetchedAt: string;
    /** Provider-stated generation time, when the provider states one. */
    generatedAt: string | null;
    /** Earliest time the provider's documented cache window allows a newer answer, when documented. */
    expiresAt: string | null;
    /** Last chain block an indexer had processed, when the provider reports it. */
    indexedBlock: bigint | null;
  };

export interface Observation<T> {
  value: T | null;
  status: EvidenceStatus;
  reasons: readonly ReasonCode[];
  provenance: Provenance;
}

/**
 * Builds an observation and derives its status.
 *
 * No value is `unknown`, and always names why. A value with any reason is `degraded`. Only a value with no
 * reason at all is `normal`.
 */
export function observe<T>(value: T | null, provenance: Provenance, reasons: readonly ReasonCode[] = []): Observation<T> {
  const unique = reasons.filter((reason, index) => reasons.indexOf(reason) === index);
  if (value === null) {
    return { value, status: "unknown", reasons: unique.length > 0 ? unique : ["unreadable"], provenance };
  }
  return { value, status: unique.length > 0 ? "degraded" : "normal", reasons: unique, provenance };
}
