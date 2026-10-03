import { decodeEventLog, parseAbi, toEventSelector, type Abi, type Address, type Hex, type Log, type TransactionReceipt } from "viem";
import { crestAccountAbi } from "@crest/contracts";
import type { GuardianReceiptEvidence } from "./postconditions.ts";
import type { GuardianActionKind } from "./validate.ts";

const crest = crestAccountAbi as Abi;
const morphoRepay = parseAbi(["event Repay(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets,uint256 shares)"]);
const vaultWithdraw = parseAbi(["event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)"]);
const eventName = { freeze: "BorrowingFrozen", repay_reserve: "RepaidFromReserve", repay_strategy: "RepaidFromStrategy" } as const;

export interface GuardianReceiptRoute {
  account: Address;
  guardian: Address;
  morpho: Address;
  vault: Address;
  marketId: Hex;
}

/** Decode exact transaction evidence; an absent, malformed or ambiguous relevant log cannot pass postconditions. */
export function decodeGuardianReceipt(
  receipt: TransactionReceipt, route: GuardianReceiptRoute, action: GuardianActionKind,
): GuardianReceiptEvidence {
  const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
  if (!same(receipt.to, route.account) || !same(receipt.from, route.guardian)) throw new Error("Guardian receipt target or sender changed");
  if (receipt.status !== "success") return { success: false };
  const name = eventName[action];
  if (!name) throw new Error("Guardian action is not permitted");
  const event = crest.find((entry) => entry.type === "event" && entry.name === name);
  if (event === undefined || event.type !== "event") throw new Error("Guardian event is absent from compiled ABI");
  const crestLog = oneLog(receipt.logs, route.account, toEventSelector(event));
  const morphoLog = action === "freeze" ? undefined : oneLog(receipt.logs, route.morpho, toEventSelector(morphoRepay[0]));
  const vaultLog = action !== "repay_strategy" ? undefined : oneLog(receipt.logs, route.vault, toEventSelector(vaultWithdraw[0]));
  const result: GuardianReceiptEvidence = { success: true };
  if (crestLog) {
    const { args } = decodeEventLog({ abi: crest, data: crestLog.data, topics: crestLog.topics, strict: true });
    const fields = args as unknown as Record<string, unknown>;
    result.crestEvent = {
      kind: action, actor: fields.actor as Address,
      ...(action === "freeze" ? {} : {
        assets: fields.repaidAssets as bigint ?? fields.withdrawnAssets as bigint,
        debtBefore: fields.debtBefore as bigint,
        debtAfter: fields.debtAfter as bigint,
      }),
    };
  }
  if (morphoLog) {
    const { args } = decodeEventLog({ abi: morphoRepay, data: morphoLog.data, topics: morphoLog.topics, strict: true });
    if (args.id.toLowerCase() === route.marketId.toLowerCase()) result.morphoRepay = { beneficiary: args.onBehalf, assets: args.assets };
  }
  if (vaultLog) {
    const { args } = decodeEventLog({ abi: vaultWithdraw, data: vaultLog.data, topics: vaultLog.topics, strict: true });
    result.vaultWithdraw = { owner: args.owner, receiver: args.receiver, assets: args.assets };
  }
  return result;
}

function oneLog(logs: readonly Log[], address: Address, topic: Hex): Log | undefined {
  const matching = logs.filter((log) => log.address.toLowerCase() === address.toLowerCase() && log.topics[0]?.toLowerCase() === topic.toLowerCase());
  if (matching.length > 1) throw new Error("Ambiguous Guardian receipt events");
  return matching[0];
}
