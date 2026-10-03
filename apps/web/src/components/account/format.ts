export function compactAddress(value: string | null | undefined) {
  if (!value) return "Unavailable";
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export function decimal(value: string | null | undefined, decimals: number, symbol?: string) {
  if (value === null || value === undefined) return "Unavailable";
  try {
    const raw = BigInt(value);
    const magnitude = raw < 0n ? -raw : raw;
    const base = 10n ** BigInt(decimals);
    const whole = magnitude / base;
    const fraction = (magnitude % base).toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
    return `${raw < 0n ? "-" : ""}${whole.toLocaleString()}${fraction ? `.${fraction}` : ""}${symbol ? ` ${symbol}` : ""}`;
  } catch {
    return "Unavailable";
  }
}

/** Owner-entered percentage points to the 18-decimal ratio used by onchain policy. */
export function percentPointsToWad(value: string): string {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error("LTV values must be decimal percentage points");
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > 16) throw new Error("LTV percentage exceeds 16 decimal places of WAD precision");
  return (BigInt(`${whole}${fraction}`) * 10n ** BigInt(16 - fraction.length)).toString();
}

export function percentFromWad(value: string | null | undefined) {
  if (value === null || value === undefined) return "Unavailable";
  try {
    return `${(Number(BigInt(value)) / 1e16).toFixed(2)}%`;
  } catch {
    return "Unavailable";
  }
}

export function percentFromBps(value: string | null | undefined) {
  if (value === null || value === undefined) return "Unavailable";
  try {
    return `${(Number(BigInt(value)) / 100).toFixed(2)}%`;
  } catch {
    return "Unavailable";
  }
}
