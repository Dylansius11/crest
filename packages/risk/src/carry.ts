import type { EvidenceStatus, Observation, ReasonCode } from "@crest/domain";
import { comparability } from "@crest/rates";
import type { Incentive, RateValue, RateWindow, VaultFees } from "@crest/rates";

import { BPS, ceilDiv, floorDiv, WAD } from "./math.ts";

export interface CarryInput {
  /** Y: quoted assets of the account's vault shares. */
  strategyAssets: bigint;
  /** D: accrued Morpho debt. */
  debtAssets: bigint;
  borrowRate: Observation<RateValue>;
  vaultRate: Observation<RateValue>;
  fees: Observation<VaultFees>;
  vaultIncentives: Observation<Incentive[]>;
  marketIncentives: Observation<Incentive[]>;
}

/**
 * A projected annual estimate, `Y·r_y + R_i − D·r_b − F`, with every term kept separate.
 *
 * It is never a realized figure: realized vault earnings and realized debt reduction come only from canonical
 * events. Every rounding goes against the owner (yield down, cost and fees up). Fields are null when the two
 * rates cannot honestly be netted, never zero.
 */
export interface CarryEstimate {
  kind: "projected";
  status: EvidenceStatus;
  reasons: ReasonCode[];
  window: RateWindow | null;
  convention: RateValue["convention"] | null;
  strategyAssets: bigint;
  debtAssets: bigint;
  /** Morpho pays nothing on collateral. Always zero, stated so no surface can imply otherwise. */
  collateralYieldAssets: 0n;
  vaultYieldAssets: bigint | null;
  borrowCostAssets: bigint | null;
  /** Vault performance and management fees. Subtracted even if the provider APY is already net of them. */
  feeAssets: bigint | null;
  /** Reward programs, separate from native yield. Null when any reward source is unknown. */
  incentiveAssets: bigint | null;
  annualCarryAssets: bigint | null;
  /** `annualCarryAssets / strategyAssets`. Null with nothing deployed; always read with its numerator. */
  spreadBps: bigint | null;
  /** Net vault rate minus borrow rate for one newly borrowed and deployed unit. Excludes incentives; gates owner borrowing. */
  marginalSpreadBps: bigint | null;
}

function incentiveAssets(input: CarryInput): bigint | null {
  if (input.vaultIncentives.status !== "normal" || input.marketIncentives.status !== "normal") return null;
  const supply = (input.vaultIncentives.value ?? []).filter((reward) => reward.side === "supply");
  const borrow = (input.marketIncentives.value ?? []).filter((reward) => reward.side === "borrow");
  return supply.reduce((sum, reward) => sum + (input.strategyAssets * reward.aprWad) / WAD, 0n)
    + borrow.reduce((sum, reward) => sum + (input.debtAssets * reward.aprWad) / WAD, 0n);
}

export function estimateCarry(input: CarryInput): CarryEstimate {
  const { borrowRate, vaultRate, fees, strategyAssets, debtAssets } = input;
  const reasons: ReasonCode[] = [...comparability(borrowRate, vaultRate), ...fees.reasons];
  if (borrowRate.value?.kind === "vault_native" || vaultRate.value?.kind === "market_borrow") reasons.push("identity_mismatch");
  const unique = reasons.filter((reason, index) => reasons.indexOf(reason) === index);
  const unknown: CarryEstimate = {
    kind: "projected",
    status: "unknown",
    reasons: unique.length > 0 ? unique : ["unreadable"],
    window: null,
    convention: null,
    strategyAssets,
    debtAssets,
    collateralYieldAssets: 0n,
    vaultYieldAssets: null,
    borrowCostAssets: null,
    feeAssets: null,
    incentiveAssets: null,
    annualCarryAssets: null,
    spreadBps: null,
    marginalSpreadBps: null,
  };
  const incomparable = unique.some((reason) => reason === "convention_mismatch" || reason === "window_mismatch" || reason === "identity_mismatch");
  if (borrowRate.value === null || vaultRate.value === null || fees.value === null || incomparable) return unknown;

  const borrowWad = (borrowRate.value.value * WAD) / borrowRate.value.scale;
  const vaultWad = (vaultRate.value.value * WAD) / vaultRate.value.scale;
  const { performanceFeeWad, managementFeeAprWad } = fees.value;

  const vaultYieldAssets = floorDiv(strategyAssets * vaultWad, WAD);
  const borrowCostAssets = ceilDiv(debtAssets * borrowWad, WAD);
  const performanceFee = vaultYieldAssets > 0n ? ceilDiv(vaultYieldAssets * performanceFeeWad, WAD) : 0n;
  const feeAssets = performanceFee + ceilDiv(strategyAssets * managementFeeAprWad, WAD);
  const incentives = incentiveAssets(input);
  const annualCarryAssets = vaultYieldAssets - borrowCostAssets - feeAssets + (incentives ?? 0n);
  const netVaultWad = (vaultWad * (WAD - performanceFeeWad)) / WAD - managementFeeAprWad;

  return {
    ...unknown,
    status: unique.length > 0 ? "degraded" : "normal",
    reasons: unique,
    window: vaultRate.value.window,
    convention: vaultRate.value.convention,
    vaultYieldAssets,
    borrowCostAssets,
    feeAssets,
    incentiveAssets: incentives,
    annualCarryAssets,
    spreadBps: strategyAssets > 0n ? floorDiv(annualCarryAssets * BPS, strategyAssets) : null,
    marginalSpreadBps: floorDiv((netVaultWad - borrowWad) * BPS, WAD),
  };
}
