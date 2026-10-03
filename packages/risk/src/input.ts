import type { Address } from "viem";

import type { CrestAccountPolicy, FeedRound, PinnedBlock } from "@crest/chain";
import type { Observation } from "@crest/domain";
import type { MarketSnapshot, PositionSnapshot } from "@crest/morpho";
import type { CompiledPolicy } from "@crest/policy";
import type { Incentive, RateValue, VaultFees } from "@crest/rates";
import type { LifecycleAssessment } from "@crest/robinhood";
import type { VaultPosition, VaultSnapshot } from "@crest/vault";

import type { ScenarioSet } from "./scenarios.ts";

/** The Crest Account's own onchain state, read at the pinned block. */
export interface AccountState {
  account: Address;
  borrowingFrozen: boolean;
  policyNonce: bigint;
  /** Loan-token balance held by the account itself, outside the vault. */
  idleReserveAssets: bigint;
  /** Exact pinned onchain configuration, when the account reader provides it. */
  policy?: CrestAccountPolicy;
}

export interface OracleInputs {
  /** Morpho market oracle `price()`: the valuation Morpho liquidates on, and the one capacity uses. */
  marketPrice: Observation<bigint>;
  /** The Chainlink feeds inside that oracle: Crest's independent feed-only valuation. */
  collateralFeed: Observation<FeedRound>;
  loanFeed: Observation<FeedRound>;
}

export interface RateInputs {
  borrow: Observation<RateValue>;
  vault: Observation<RateValue>;
  fees: Observation<VaultFees>;
  vaultIncentives: Observation<Incentive[]>;
  marketIncentives: Observation<Incentive[]>;
}

/**
 * Everything one assessment depends on, and nothing else. The engine reads no clock, network, or storage, so the
 * same input always yields the same assessment. Onchain observations must share the pinned `head` block.
 */
export interface RiskInput {
  /** The active compiled policy and the nonce its canonical `PolicyConfigured` event carried. */
  policy: { compiled: CompiledPolicy; nonce: bigint };
  head: Observation<PinnedBlock>;
  account: Observation<AccountState>;
  market: Observation<MarketSnapshot>;
  position: Observation<PositionSnapshot>;
  oracle: OracleInputs;
  vault: Observation<VaultSnapshot>;
  strategy: Observation<VaultPosition>;
  rates: RateInputs;
  lifecycle: LifecycleAssessment;
  /**
   * Net loan-token assets deposited into the vault, reconciled from canonical deposit and withdrawal events.
   * Null until reconciled. Only this makes a strategy surplus realized rather than projected.
   */
  strategyCostBasisAssets: bigint | null;
  scenarios: ScenarioSet;
}

/** Inputs whose degradation stops owner borrowing. Rates are judged separately: they only gate new debt. */
export const SOURCE_NAMES = ["head", "account", "market", "position", "marketPrice", "collateralFeed", "loanFeed", "vault", "strategy", "lifecycle"] as const;

export type SourceName = (typeof SOURCE_NAMES)[number];
