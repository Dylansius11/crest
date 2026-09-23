const WAD = 10n ** 18n;

/**
 * The three distinct quantities a Stock Token balance has. They are never interchangeable:
 *
 * - `rawBalance`: ERC-20 units, what Morpho holds as collateral.
 * - `underlyingShares`: raw balance times `uiMultiplier`, for display as equity shares.
 * - `feedValue`: raw balance times the Chainlink token price. That price already includes the multiplier,
 *   so the multiplier is deliberately absent from this product. Applying it again is the double-adjustment trap.
 */
export interface StockTokenValues {
  rawBalance: bigint;
  /** 18-decimal share units. */
  underlyingShares: bigint;
  /** USD in the feed's decimals. */
  feedValue: bigint;
  feedDecimals: number;
}

export function stockTokenValues(input: {
  rawBalance: bigint;
  uiMultiplierWad: bigint;
  /** Chainlink token price for 1e18 raw units. */
  feed: { answer: bigint; decimals: number };
}): StockTokenValues {
  return {
    rawBalance: input.rawBalance,
    underlyingShares: (input.rawBalance * input.uiMultiplierWad) / WAD,
    feedValue: (input.rawBalance * input.feed.answer) / WAD,
    feedDecimals: input.feed.decimals,
  };
}

export type OracleComposition = "feed_only" | "feed_times_multiplier" | "indistinguishable" | "unexplained";

/**
 * Explains a Morpho market oracle's `price()` in terms of its Chainlink inputs.
 *
 * Morpho's Chainlink-style oracles quote collateral in loan token scaled by
 * `10^(36 + loanDecimals + loanFeedDecimals - collateralDecimals - collateralFeedDecimals)`. If the price equals
 * that ratio, the oracle uses the feed as published. If it equals the ratio times `uiMultiplier`, the oracle
 * applies the multiplier on top of a feed Robinhood and Chainlink document as already multiplier-adjusted.
 * Agreement is required to one part in 1e12, well above integer rounding and far below any real divergence.
 */
export function classifyMarketOracle(input: {
  oraclePrice: bigint;
  collateralAnswer: bigint;
  loanAnswer: bigint;
  uiMultiplierWad: bigint;
  decimals: { collateralToken: number; loanToken: number; collateralFeed: number; loanFeed: number };
}): OracleComposition {
  const { decimals } = input;
  const exponent = 36 + decimals.loanToken + decimals.loanFeed - decimals.collateralToken - decimals.collateralFeed;
  if (exponent < 0 || input.loanAnswer <= 0n || input.collateralAnswer <= 0n) return "unexplained";
  const scale = 10n ** BigInt(exponent);
  const feedOnly = (scale * input.collateralAnswer) / input.loanAnswer;
  const withMultiplier = (scale * input.collateralAnswer * input.uiMultiplierWad) / (WAD * input.loanAnswer);
  const close = (candidate: bigint) => {
    const difference = input.oraclePrice > candidate ? input.oraclePrice - candidate : candidate - input.oraclePrice;
    return difference * 10n ** 12n <= candidate;
  };
  const matchesFeed = close(feedOnly);
  const matchesMultiplied = close(withMultiplier);
  if (matchesFeed && matchesMultiplied) return "indistinguishable";
  if (matchesMultiplied) return "feed_times_multiplier";
  if (matchesFeed) return "feed_only";
  return "unexplained";
}
