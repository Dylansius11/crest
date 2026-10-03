import { crestAccountAbi } from "@crest/contracts";
import { BaseError, decodeErrorResult, isHex } from "viem";
import type { Abi, Hex } from "viem";

import { decimal } from "../components/account/format";
import { activeTokens } from "./manifest";

const { collateral, loan } = activeTokens;

/** Errors whose two arguments are token amounts: the limit and the amount the action would have produced. */
const BOUNDS: Record<string, { token: typeof loan; limit: string; result: string; meaning: string }> = {
  CollateralCapExceeded: { token: collateral, limit: "cap", result: "would reach", meaning: "Collateral cap exceeded" },
  DebtCeilingExceeded: { token: loan, limit: "ceiling", result: "debt would reach", meaning: "Debt ceiling exceeded" },
  StrategyCapExceeded: { token: loan, limit: "cap", result: "vault would hold", meaning: "Strategy cap exceeded" },
  ReserveFloorViolation: { token: loan, limit: "floor", result: "reserve would fall to", meaning: "Reserve floor would be breached" },
  StrategyFloorViolation: { token: loan, limit: "floor", result: "vault would fall to", meaning: "Vault floor would be breached" },
};

const PLAIN: Record<string, string> = {
  Unauthorized: "Only the account owner may send this action",
  BorrowingIsFrozen: "Borrowing is frozen; the owner must unfreeze it first",
  InvalidConfiguration: "The policy configuration is invalid",
  LtvPolicyInvalid: "The LTV bands are invalid",
  ActivePositionOrBalance: "The account still holds a position or balance",
  RepayAmountZero: "The repayment amount is zero",
};

/** The first revert payload anywhere in an error's cause chain; RPC errors nest it one or two levels down. */
function revertData(error: unknown): Hex | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const data = (current as { data?: unknown }).data;
    if (typeof data === "string" && isHex(data) && data.length >= 10) return data;
    const nested = (data as { data?: unknown } | undefined)?.data;
    if (typeof nested === "string" && isHex(nested) && nested.length >= 10) return nested;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Names a Crest Account revert in owner terms, with amounts in token units; falls back to viem's short message. */
export function revertReason(error: unknown): string {
  const data = revertData(error);
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: crestAccountAbi as Abi, data });
      const bound = BOUNDS[decoded.errorName];
      const args = decoded.args ?? [];
      if (bound && typeof args[0] === "bigint" && typeof args[1] === "bigint") {
        const { token } = bound;
        return `${bound.meaning}: ${bound.limit} ${decimal(args[0].toString(), token.decimals, token.symbol)}, ${bound.result} ${decimal(args[1].toString(), token.decimals, token.symbol)}`;
      }
      return PLAIN[decoded.errorName] ?? `The account reverted with ${decoded.errorName}`;
    } catch {
      // Not a Crest Account error (Morpho, the vault, or a token); viem's message below names it if it can.
    }
  }
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : "unknown error";
}
