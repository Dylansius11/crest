import { encodeFunctionData, getAddress, type Abi, type Address, type Hex } from "viem";
import { crestAccountAbi, GUARDIAN_SELECTORS } from "@crest/contracts";
import type { GuardianAction } from "./validate.ts";

export function buildGuardianCall(action: GuardianAction, account: Address): { to: Address; data: Hex; selector: string } {
  const abi = crestAccountAbi as Abi;
  let selector: string;
  let data: Hex;
  switch (action.kind) {
    case "freeze":
      selector = "freezeBorrowing()";
      data = encodeFunctionData({ abi, functionName: "freezeBorrowing" });
      break;
    case "repay_reserve":
    case "repay_strategy":
      if (action.assets <= 0n) throw new Error("Guardian repayment must be positive");
      selector = action.kind === "repay_reserve" ? "repayFromReserve(uint256)" : "repayFromStrategy(uint256)";
      data = encodeFunctionData({ abi, functionName: action.kind === "repay_reserve" ? "repayFromReserve" : "repayFromStrategy", args: [action.assets] });
      break;
    default:
      throw new Error("Guardian action is not permitted");
  }
  if (!(GUARDIAN_SELECTORS as readonly string[]).includes(selector)) throw new Error("Guardian selector is not in the reviewed ABI");
  return { to: getAddress(account), data, selector };
}
