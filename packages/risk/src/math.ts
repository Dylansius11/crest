export const WAD = 10n ** 18n;
export const BPS = 10_000n;
/** Morpho `ORACLE_PRICE_SCALE`: `price()` quotes 1 collateral base unit in loan base units times 1e36. */
export const ORACLE_PRICE_SCALE = 10n ** 36n;

/** Rounds toward negative infinity for any sign of `numerator`; `denominator` must be positive. */
export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n ? quotient - 1n : quotient;
}

/** Rounds toward positive infinity for any sign of `numerator`; `denominator` must be positive. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator > 0n ? quotient + 1n : quotient;
}

export function minOf(first: bigint, ...rest: bigint[]): bigint {
  return rest.reduce((low, value) => (value < low ? value : low), first);
}

/** `a - b` clamped at zero: a remaining allowance can never be negative. */
export function remaining(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}
