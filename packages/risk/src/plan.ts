import { guardianActionSchema } from "@crest/domain";
import type { GuardianAction } from "@crest/domain";

import type { RepaymentBounds, RiskAssessment } from "./assess.ts";
import { minOf } from "./math.ts";

/** What the planner reads. It never sees capacity, rates, or the owner recommendation, so it cannot borrow. */
export type ActionInput = Pick<RiskAssessment, "freezeRequired" | "borrowingFrozen" | "repayment">;

export interface RepaymentSelection {
  source: "reserve" | "strategy";
  assets: bigint;
}

/**
 * Picks the one repayment source that reduces the most debt now.
 *
 * Protection may use the idle reserve or the strategy, and prefers the reserve on a tie because it needs no vault
 * withdrawal. Exiting yield and harvesting are strategy withdrawals by definition. Capacities already include the
 * per-action cap, the floors, the debt, and current withdrawable liquidity, so the result is what the contract
 * would accept as well.
 */
export function selectRepayment(repayment: RepaymentBounds): RepaymentSelection | null {
  if (repayment.purpose === "none" || repayment.needAssets === 0n) return null;
  const fromStrategy = minOf(repayment.needAssets, repayment.strategyCapacityAssets);
  const fromReserve = repayment.purpose === "protect" ? minOf(repayment.needAssets, repayment.reserveCapacityAssets) : 0n;
  if (fromReserve === 0n && fromStrategy === 0n) return null;
  return fromReserve >= fromStrategy ? { source: "reserve", assets: fromReserve } : { source: "strategy", assets: fromStrategy };
}

/**
 * The one Guardian action for an assessment, or null for none.
 *
 * Freeze always comes first and alone: a repayment is only planned once borrowing is frozen, or when the state
 * never needed a freeze (a harvest). The result can only be one of the three Guardian selectors; there is no path
 * that produces a borrow, a transfer, or a call anywhere else.
 */
export function planGuardianAction(input: ActionInput): GuardianAction | null {
  if (input.freezeRequired && input.borrowingFrozen !== true) return { kind: "freeze", selector: "freezeBorrowing()" };
  const selection = selectRepayment(input.repayment);
  if (selection === null) return null;
  // Parsing through the domain schema is the one way to mint a branded amount, and it rejects a zero repayment.
  return guardianActionSchema.parse(selection.source === "reserve"
    ? { kind: "repay_reserve", selector: "repayFromReserve(uint256)", requestedAssets: selection.assets.toString() }
    : { kind: "repay_strategy", selector: "repayFromStrategy(uint256)", requestedAssets: selection.assets.toString() });
}
