import { observe } from "@crest/domain";
import type { BlockRef, FreshnessBudget, Observation, ReasonCode } from "@crest/domain";
import { classifyMarketOracle } from "@crest/robinhood";
import type { LifecycleAssessment, OracleComposition } from "@crest/robinhood";

import type { RiskInput, SourceName } from "./input.ts";
import { BPS, ceilDiv, WAD } from "./math.ts";

/**
 * Crest's own check on Morpho's collateral valuation.
 *
 * Capacity always uses Morpho's `price()`, because that is what Morpho liquidates on. Crest's feed-only price is
 * the collateral feed over the loan feed, with no multiplier applied. The composition names which known formula
 * explains Morpho's price; the divergence is the gap relative to the feed-only price, rounded up so the gate
 * trips first. An unexplained composition or a gap above policy is `oracle_divergence`.
 */
export interface OracleView {
  composition: OracleComposition | null;
  /** Feed-only price in Morpho's scale: 1 collateral base unit in loan base units, times 1e36. */
  feedOnlyPrice: bigint | null;
  divergenceWad: bigint | null;
}

export interface Screened {
  /** The input with every policy budget, horizon, and identity check applied. Reasons are only ever added. */
  input: RiskInput;
  sources: Record<SourceName, readonly ReasonCode[]>;
  oracle: OracleView;
  block: BlockRef | null;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

interface Horizon {
  chainId: number;
  block: BlockRef | null;
  maxIndexLagBlocks: bigint;
}

/**
 * Onchain reads must come from the pinned block on the reviewed chain. Indexed HTTP values may trail the pinned
 * head by at most the policy's index lag. Unindexed HTTP values are judged by age elsewhere.
 */
function horizonReasons(observation: Observation<unknown>, horizon: Horizon): ReasonCode[] {
  const { provenance } = observation;
  if (provenance.kind === "http") {
    const lagging = provenance.indexedBlock !== null && horizon.block !== null && horizon.block.number - provenance.indexedBlock > horizon.maxIndexLagBlocks;
    return lagging ? ["stale"] : [];
  }
  if (provenance.chainId !== horizon.chainId) return ["identity_mismatch"];
  if (horizon.block === null) return [];
  return provenance.block.number === horizon.block.number && provenance.block.hash === horizon.block.hash ? [] : ["block_skew"];
}

/** Seconds between an HTTP response and the pin's wall clock. A response fetched after the pin is age zero. */
function httpAgeSeconds(observation: Observation<unknown>, nowSeconds: bigint): bigint | null {
  if (observation.provenance.kind !== "http") return null;
  const millis = Date.parse(observation.provenance.generatedAt ?? observation.provenance.fetchedAt);
  if (Number.isNaN(millis)) return null;
  const stamp = BigInt(Math.floor(millis / 1000));
  return nowSeconds > stamp ? nowSeconds - stamp : 0n;
}

function screenLifecycle(lifecycle: LifecycleAssessment, freshness: FreshnessBudget, horizon: Horizon, nowSeconds: bigint | null): LifecycleAssessment {
  const { token, asset, quote, actions } = lifecycle.inputs;
  const extra: ReasonCode[] = [...horizonReasons(token, horizon)];
  for (const [observation, budget] of [[asset, freshness.maxAssetAgeSeconds], [quote, freshness.maxQuoteAgeSeconds], [actions, freshness.maxCorporateActionsAgeSeconds]] as const) {
    const age = nowSeconds === null || observation.value === null ? null : httpAgeSeconds(observation, nowSeconds);
    if (age !== null && age > budget) extra.push("stale");
  }
  const reasons = [...lifecycle.reasons, ...extra].filter((reason, index, all) => all.indexOf(reason) === index);
  return { ...lifecycle, status: token.value === null ? "unknown" : reasons.length > 0 ? "degraded" : "normal", reasons };
}

function oracleView(input: RiskInput): OracleView {
  const { route } = input.policy.compiled;
  const price = input.oracle.marketPrice.value;
  const collateral = input.oracle.collateralFeed.value;
  const loan = input.oracle.loanFeed.value;
  const multiplierWad = input.lifecycle.multiplierWad;
  if (collateral === null || loan === null) return { composition: null, feedOnlyPrice: null, divergenceWad: null };

  const decimals = { collateralToken: route.tokens.collateralDecimals, loanToken: route.tokens.loanDecimals, collateralFeed: collateral.decimals, loanFeed: loan.decimals };
  const composition = price === null || multiplierWad === null
    ? null
    : classifyMarketOracle({ oraclePrice: price, collateralAnswer: collateral.answer, loanAnswer: loan.answer, uiMultiplierWad: multiplierWad, decimals });
  const exponent = 36 + decimals.loanToken + decimals.loanFeed - decimals.collateralToken - decimals.collateralFeed;
  if (exponent < 0 || collateral.answer <= 0n || loan.answer <= 0n) return { composition, feedOnlyPrice: null, divergenceWad: null };

  // Exact rational comparison: |price·loan − scale·collateral| / (scale·collateral), never via a rounded price.
  const scaled = 10n ** BigInt(exponent) * collateral.answer;
  const gap = price === null ? null : price * loan.answer - scaled;
  const divergenceWad = gap === null ? null : ceilDiv((gap < 0n ? -gap : gap) * WAD, scaled);
  return { composition, feedOnlyPrice: scaled / loan.answer, divergenceWad };
}

/**
 * Applies the active policy's own budgets and the route's identities to every input.
 *
 * Adapters already mark what they can see, but they run with their caller's budgets. Re-applying the policy here
 * means a looser adapter budget can never pass stale data into an assessment, and reads from different blocks or
 * for a different account can never be combined into one picture of this account.
 */
export function screenInput(input: RiskInput): Screened {
  const { compiled, nonce } = input.policy;
  const { route, policy } = compiled;
  const { freshness } = policy;
  const head = input.head.value;
  const horizon: Horizon = { chainId: route.chainId, block: head?.block ?? null, maxIndexLagBlocks: freshness.maxIndexLagBlocks };
  const nowSeconds = head === null ? null : head.block.timestamp + head.headLagSeconds;
  const oracle = oracleView(input);

  // Re-observing derives status again from the enlarged reason list, so it can only move away from normal.
  const at = <T>(observation: Observation<T>, extra: readonly ReasonCode[] = []): Observation<T> => {
    const added = [...horizonReasons(observation, horizon), ...extra];
    return added.length === 0 ? observation : observe(observation.value, observation.provenance, [...observation.reasons, ...added]);
  };
  const feedReasons = (observation: RiskInput["oracle"]["collateralFeed"], expected: string): ReasonCode[] => {
    const round = observation.value;
    if (round === null) return [];
    return [
      ...(sameAddress(round.feed, expected) ? [] : (["identity_mismatch"] as const)),
      ...(round.answer <= 0n || round.updatedAt === 0n ? (["oracle_invalid"] as const) : []),
      ...(round.ageSeconds > freshness.maxFeedAgeSeconds ? (["stale"] as const) : []),
    ];
  };

  const account = input.account.value;
  const market = input.market.value;
  const position = input.position.value;
  const vault = input.vault.value;
  const strategy = input.strategy.value;
  const price = input.oracle.marketPrice.value;
  const divergenceBound = (policy.maxOracleDivergenceBps * WAD) / BPS;
  const divergent = oracle.composition === "unexplained" || (oracle.divergenceWad !== null && oracle.divergenceWad > divergenceBound);

  const screened: RiskInput = {
    ...input,
    head: at(input.head, head !== null && head.headLagSeconds > freshness.maxHeadLagSeconds ? ["head_lag"] : []),
    account: at(input.account, [
      ...(account !== null && !sameAddress(account.account, route.account) ? (["identity_mismatch"] as const) : []),
      ...(account !== null && account.policyNonce !== nonce ? (["conflict"] as const) : []),
    ]),
    market: at(input.market, market !== null && !(
      market.id.toLowerCase() === route.marketId
      && sameAddress(market.params.loanToken, route.market.loanToken)
      && sameAddress(market.params.collateralToken, route.market.collateralToken)
      && sameAddress(market.params.oracle, route.market.oracle)
      && sameAddress(market.params.irm, route.market.irm)
      && market.params.lltv === route.market.lltv
    ) ? ["identity_mismatch"] : []),
    position: at(input.position, position !== null && !sameAddress(position.account, route.account) ? ["identity_mismatch"] : []),
    oracle: {
      marketPrice: at(input.oracle.marketPrice, [...(price === 0n ? (["oracle_invalid"] as const) : []), ...(divergent ? (["oracle_divergence"] as const) : [])]),
      collateralFeed: at(input.oracle.collateralFeed, feedReasons(input.oracle.collateralFeed, route.feeds.collateral)),
      loanFeed: at(input.oracle.loanFeed, feedReasons(input.oracle.loanFeed, route.feeds.loan)),
    },
    vault: at(input.vault, vault !== null && (!sameAddress(vault.vault, route.vault) || !sameAddress(vault.asset, route.market.loanToken)) ? ["identity_mismatch"] : []),
    // A strategy that cannot exit what it already holds is illiquid input: new debt would deploy into it.
    strategy: at(input.strategy, [
      ...(strategy !== null && !sameAddress(strategy.account, route.account) ? (["identity_mismatch"] as const) : []),
      ...(strategy !== null && strategy.availableAssets < strategy.quotedAssets ? (["withdrawal_constrained"] as const) : []),
    ]),
    rates: {
      borrow: at(input.rates.borrow),
      vault: at(input.rates.vault),
      fees: at(input.rates.fees),
      vaultIncentives: at(input.rates.vaultIncentives),
      marketIncentives: at(input.rates.marketIncentives),
    },
    lifecycle: screenLifecycle(input.lifecycle, freshness, horizon, nowSeconds),
  };

  const sources: Record<SourceName, readonly ReasonCode[]> = {
    head: screened.head.reasons,
    account: screened.account.reasons,
    market: screened.market.reasons,
    position: screened.position.reasons,
    marketPrice: screened.oracle.marketPrice.reasons,
    collateralFeed: screened.oracle.collateralFeed.reasons,
    loanFeed: screened.oracle.loanFeed.reasons,
    vault: screened.vault.reasons,
    strategy: screened.strategy.reasons,
    lifecycle: screened.lifecycle.reasons,
  };
  return { input: screened, sources, oracle, block: horizon.block };
}
