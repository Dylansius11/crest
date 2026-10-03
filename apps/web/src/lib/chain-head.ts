/**
 * The monitor and Custos refuse a head older than 120 s; an owner simulation is held to the same budget, so a
 * lagging or cached RPC can never ground a signature on conditions that are no longer current.
 */
export const MAX_HEAD_LAG_SECONDS = 120n;

/** Seconds a head may sit ahead of this clock before it is treated as a skewed, untrusted read. */
export const MAX_HEAD_LEAD_SECONDS = 60n;

/** Returns why a head cannot ground a simulation, or `null` when it is fresh. */
export function headLagError(blockTimestamp: bigint, nowMs: number): string | null {
  const now = BigInt(Math.floor(nowMs / 1000));
  if (blockTimestamp - now > MAX_HEAD_LEAD_SECONDS) return `RPC head is ${blockTimestamp - now} s ahead of this clock. Check the system clock before signing.`;
  if (now - blockTimestamp > MAX_HEAD_LAG_SECONDS) return `RPC head is ${now - blockTimestamp} s old, beyond the ${MAX_HEAD_LAG_SECONDS} s budget. The RPC may be lagging or cached; nothing was simulated.`;
  return null;
}
