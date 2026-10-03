import type { RecordedIntervention, RecordedPosition, RecordedRate, RecordedRepayment } from "@/components/account/types";

/**
 * Pure derivations for the owner position screen. Every function reads recorded evidence only and returns a
 * tagged state, so a missing, degraded, or contradictory input renders as itself instead of as a number.
 */

const WAD = 10n ** 18n;

type Snapshot = NonNullable<RecordedPosition["snapshot"]>;
type Assessment = NonNullable<RecordedPosition["assessment"]>;

export type BandZone = "unavailable" | "no-debt" | "below-lower" | "in-band" | "above-upper" | "critical" | "beyond-lltv";

export type BandMarker = { key: "lower" | "target" | "upper" | "critical" | "lltv"; label: string; wad: bigint; at: number };

export type BandView = {
  zone: BandZone;
  ltvWad: bigint | null;
  /** Current LTV as a share of the strip, clamped to the LLTV terminal; `null` without a valuation. */
  currentAt: number | null;
  markers: BandMarker[];
  /** Debt the owner could add to reach target; always an owner approval, never a Guardian action. */
  borrowToTargetAssets: bigint | null;
  /** Debt that must be repaid to return to target. */
  repayToTargetAssets: bigint | null;
};

const at = (wad: bigint, lltv: bigint) => (lltv === 0n ? 0 : Math.min(100, Number((wad * 10_000n) / lltv) / 100));

/** Places the policy band and the current LTV against the Morpho LLTV terminal. */
export function bandView(snapshot: Snapshot, lltvWad: bigint): BandView {
  const lower = BigInt(snapshot.lowerLtvWad);
  const target = BigInt(snapshot.targetLtvWad);
  const upper = BigInt(snapshot.upperLtvWad);
  const critical = BigInt(snapshot.criticalLtvWad);
  const markers: BandMarker[] = [
    { key: "lower", label: "Lower", wad: lower, at: at(lower, lltvWad) },
    { key: "target", label: "Target", wad: target, at: at(target, lltvWad) },
    { key: "upper", label: "Upper guard", wad: upper, at: at(upper, lltvWad) },
    { key: "critical", label: "Critical", wad: critical, at: at(critical, lltvWad) },
    { key: "lltv", label: "Morpho LLTV", wad: lltvWad, at: 100 },
  ];
  const debt = snapshot.debtAssets === null ? null : BigInt(snapshot.debtAssets);
  const ltv = snapshot.ltvWad === null ? null : BigInt(snapshot.ltvWad);
  const value = snapshot.collateralValueAssets === null ? null : BigInt(snapshot.collateralValueAssets);
  const zone: BandZone = debt === 0n ? "no-debt"
    : ltv === null ? "unavailable"
    : ltv >= lltvWad ? "beyond-lltv"
    : ltv >= critical ? "critical"
    : ltv > upper ? "above-upper"
    : ltv < lower ? "below-lower"
    : "in-band";
  const targetDebt = value === null ? null : (value * target) / WAD;
  return {
    zone,
    ltvWad: ltv,
    currentAt: ltv === null ? (debt === 0n ? 0 : null) : at(ltv, lltvWad),
    markers,
    borrowToTargetAssets: targetDebt === null || debt === null ? null : targetDebt > debt ? targetDebt - debt : 0n,
    repayToTargetAssets: targetDebt === null || debt === null ? null : debt > targetDebt ? debt - targetDebt : 0n,
  };
}

export type RateView = {
  status: string;
  reasons: string[];
  /** Basis points of the recorded value/scale ratio; `null` when the rate was not read. */
  bps: bigint | null;
  basis: string | null;
  source: string | null;
  observedAt: string | null;
};

export function rateView(rate: RecordedRate): RateView {
  const bps = rate.value === null || rate.scale === null || rate.scale === "0" ? null : (BigInt(rate.value) * 10_000n) / BigInt(rate.scale);
  const basis = rate.convention === null ? null : [rate.convention.toUpperCase(), rate.window].filter((part) => part !== null).join(", ");
  return { status: rate.status, reasons: rate.reasons, bps, basis, source: rate.source, observedAt: rate.observedAt };
}

export type SpreadView = { kind: "net"; bps: bigint; inverted: boolean } | { kind: "withheld"; reason: string };

/** A net spread is printed only when both sides were read normally on the same convention and window. */
export function spreadView(borrow: RecordedRate, vault: RecordedRate): SpreadView {
  for (const [label, rate] of [["Borrow", borrow], ["Vault", vault]] as const) {
    if (rate.value === null || rate.scale === null) return { kind: "withheld", reason: `${label} rate was not read (${rate.reasons.join(", ") || "no value"}).` };
    if (rate.status !== "normal") return { kind: "withheld", reason: `${label} rate is ${rate.status} (${rate.reasons.join(", ") || "no reason recorded"}).` };
  }
  if (borrow.convention !== vault.convention || borrow.window !== vault.window) {
    return { kind: "withheld", reason: `Rates are not comparable: borrow ${borrow.convention ?? "?"} ${borrow.window ?? "?"} versus vault ${vault.convention ?? "?"} ${vault.window ?? "?"}.` };
  }
  const borrowBps = rateView(borrow).bps;
  const vaultBps = rateView(vault).bps;
  if (borrowBps === null || vaultBps === null) return { kind: "withheld", reason: "A rate has a zero scale." };
  const bps = vaultBps - borrowBps;
  return { kind: "net", bps, inverted: bps < 0n };
}

export type RepaymentView =
  | { kind: "empty"; reason: string }
  | { kind: "verified" | "postcondition-failed"; before: bigint; after: bigint; reduced: bigint; blockNumber: string; transactionHash: string };

/** Only a canonical event whose debt actually fell is verified; a non-decreasing debt is a failed postcondition. */
export function repaymentView(repayment: RecordedRepayment | null, hasSnapshot: boolean): RepaymentView {
  if (repayment === null) {
    return { kind: "empty", reason: hasSnapshot
      ? "No canonical strategy repayment is recorded for this account. Projected carry never fills this card."
      : "No recorded position yet, so there is nothing to reconcile." };
  }
  const before = BigInt(repayment.debtBeforeAssets);
  const after = BigInt(repayment.debtAfterAssets);
  return {
    kind: after < before ? "verified" : "postcondition-failed",
    before,
    after,
    reduced: after < before ? before - after : 0n,
    blockNumber: repayment.blockNumber,
    transactionHash: repayment.transactionHash,
  };
}

/** The one Guardian selector each action may call; owner actions have none. */
export const ACTION_SELECTOR: Record<string, string | null> = {
  none: null,
  owner_borrow: null,
  owner_review: null,
  freeze: "freezeBorrowing()",
  repay_reserve: "repayFromReserve(uint256)",
  repay_strategy: "repayFromStrategy(uint256)",
};

export const OWNER_NEXT_STEP: Record<string, string> = {
  NORMAL: "Nothing required. The account is inside its policy band.",
  HARVESTABLE: "Nothing required. Custos may repay surplus strategy earnings toward debt.",
  UPSIZE_AVAILABLE: "Optional. Borrowing more is your signature alone; Custos never borrows.",
  PROTECT: "Review the position. Custos may repay from the fixed vault toward target, within its cap.",
  EXIT_YIELD: "Review the strategy. Yield no longer covers borrowing, so Custos may freeze and repay from the vault.",
  CRITICAL: "Act now: repay or add collateral. Custos repays only within its per-action cap and floors.",
  DEGRADED: "Wait for healthy inputs. On the sandbox you may still borrow after acknowledging every reason code.",
};

export type InterventionOutcome = "verified" | "postcondition-failed" | "pending" | "failed" | "detected" | "superseded";

export type InterventionView = RecordedIntervention & { selector: string | null; outcome: InterventionOutcome; failedChecks: string[] };

export function interventionView(intervention: RecordedIntervention | null): InterventionView | null {
  if (intervention === null) return null;
  const failedChecks = (intervention.run?.checks ?? []).filter((check) => !check.passed).map((check) => check.kind);
  const runStatus = intervention.run?.status ?? null;
  const outcome: InterventionOutcome = failedChecks.length > 0 ? "postcondition-failed"
    : intervention.status === "superseded" ? "superseded"
    : runStatus === "completed" ? "verified"
    : runStatus === "failed" || intervention.status === "failed" ? "failed"
    : runStatus === null ? "detected"
    : "pending";
  return { ...intervention, selector: ACTION_SELECTOR[intervention.actionKind] ?? null, outcome, failedChecks };
}

export type CapitalView = {
  /** Engine-computed Guardian repayment capacity for one action; `null` when not assessed. */
  actionableAssets: bigint | null;
  constrained: boolean;
  vaultLoss: boolean;
  /** Debt exists but both repayment sources sit at or below their floors, so Custos can only freeze. */
  floorReached: boolean;
};

export function capitalView(snapshot: Snapshot, assessment: Assessment | null): CapitalView {
  const quoted = snapshot.quotedVaultAssets === null ? null : BigInt(snapshot.quotedVaultAssets);
  const withdrawable = snapshot.withdrawableVaultAssets === null ? null : BigInt(snapshot.withdrawableVaultAssets);
  const reserve = snapshot.reserveAssets === null ? null : BigInt(snapshot.reserveAssets);
  const debt = snapshot.debtAssets === null ? null : BigInt(snapshot.debtAssets);
  const reserveAtFloor = reserve !== null && reserve <= BigInt(snapshot.reserveFloorAssets);
  const strategyAtFloor = withdrawable !== null && withdrawable <= BigInt(snapshot.strategyFloorAssets);
  return {
    actionableAssets: assessment === null || assessment.repayCapacityAssets === null ? null : BigInt(assessment.repayCapacityAssets),
    constrained: quoted !== null && withdrawable !== null && withdrawable < quoted,
    vaultLoss: assessment?.reasonCodes.includes("vault_loss") ?? false,
    floorReached: debt !== null && debt > 0n && reserveAtFloor && strategyAtFloor,
  };
}

/** Formats signed basis points as a percentage with two decimals, e.g. `-125n` to `-1.25%`. */
export function percentFromBpsValue(bps: bigint): string {
  const sign = bps < 0n ? "-" : "";
  const magnitude = bps < 0n ? -bps : bps;
  return `${sign}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, "0")}%`;
}
