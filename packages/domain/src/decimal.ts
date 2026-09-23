const DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parses a provider decimal (`"1.000566080061092436"`, or a JSON float's shortest form such as
 * `"2.4215353906509307e-6"`) into an integer at `decimals` places, truncating toward zero.
 *
 * Providers send rates and multipliers as decimal text or IEEE doubles. Crest never does arithmetic on either:
 * it converts once, here, and every later step is exact bigint math. Anything that is not a plain finite
 * decimal throws, so `NaN`, `Infinity`, and empty strings can never become a number.
 */
export function parseDecimalUnits(text: string, decimals: number): bigint {
  const match = DECIMAL.exec(text.trim());
  if (match === null) throw new Error(`not a finite decimal: ${JSON.stringify(text)}`);
  const [, sign, whole = "", fraction = "", exponentText = "0"] = match;
  const digits = BigInt(`${whole}${fraction}`);
  // value = digits * 10^(exponent - fraction.length); target = value * 10^decimals.
  const shift = BigInt(exponentText) - BigInt(fraction.length) + BigInt(decimals);
  const scaled = shift >= 0n ? digits * 10n ** shift : digits / 10n ** -shift;
  return sign === "-" ? -scaled : scaled;
}
