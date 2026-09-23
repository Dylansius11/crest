/**
 * Morpho Blue arithmetic, ported line for line from `MathLib`, `SharesMathLib`, and `MorphoBalancesLib`.
 *
 * Crest must predict exactly what Morpho will compute, so every rounding direction here matches the protocol:
 * debt rounds up, shares minted for fees round down. Nothing here is approximated with floating point.
 */

export const WAD = 10n ** 18n;
const VIRTUAL_SHARES = 10n ** 6n;
const VIRTUAL_ASSETS = 1n;

export interface MarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

/** `MathLib.wTaylorCompounded`: the three-term Taylor expansion Morpho uses for `e^(x*n) - 1`. */
export function wTaylorCompounded(ratePerSecondWad: bigint, seconds: bigint): bigint {
  const firstTerm = ratePerSecondWad * seconds;
  const secondTerm = (firstTerm * firstTerm) / (2n * WAD);
  const thirdTerm = (secondTerm * firstTerm) / (3n * WAD);
  return firstTerm + secondTerm + thirdTerm;
}

/** `SharesMathLib.toAssetsUp`: the debt a borrow-share balance represents, rounded against the borrower. */
export function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const denominator = totalShares + VIRTUAL_SHARES;
  return (shares * (totalAssets + VIRTUAL_ASSETS) + denominator - 1n) / denominator;
}

/** `SharesMathLib.toSharesDown`. */
export function toSharesDown(assets: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  return (assets * (totalShares + VIRTUAL_SHARES)) / (totalAssets + VIRTUAL_ASSETS);
}

/**
 * `MorphoBalancesLib.expectedMarketBalances`: market totals as Morpho would store them after accruing interest
 * at `timestamp`. `borrowRatePerSecondWad` must be the IRM `borrowRateView` against the stored (unaccrued) market.
 */
export function accrueInterest(market: MarketState, borrowRatePerSecondWad: bigint, timestamp: bigint): MarketState {
  const elapsed = timestamp - market.lastUpdate;
  if (elapsed <= 0n) return market;
  if (market.totalBorrowAssets === 0n) return { ...market, lastUpdate: timestamp };

  const interest = (market.totalBorrowAssets * wTaylorCompounded(borrowRatePerSecondWad, elapsed)) / WAD;
  const totalSupplyAssets = market.totalSupplyAssets + interest;
  let totalSupplyShares = market.totalSupplyShares;
  if (market.fee !== 0n) {
    const feeAmount = (interest * market.fee) / WAD;
    totalSupplyShares += toSharesDown(feeAmount, totalSupplyAssets - feeAmount, market.totalSupplyShares);
  }
  return {
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets: market.totalBorrowAssets + interest,
    totalBorrowShares: market.totalBorrowShares,
    lastUpdate: timestamp,
    fee: market.fee,
  };
}
