import { describe, expect, test } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, type Address, type Hex, type TransactionReceipt } from "viem";
import { decodeGuardianReceipt } from "./reconcile.ts";

const account = "0x1111111111111111111111111111111111111111" as Address;
const guardian = "0x2222222222222222222222222222222222222222" as Address;
const morpho = "0x3333333333333333333333333333333333333333" as Address;
const vault = "0x4444444444444444444444444444444444444444" as Address;
const rogue = "0x5555555555555555555555555555555555555555" as Address;
const marketId = `0x${"ab".repeat(32)}` as Hex;
const strategyEvent = parseAbi(["event RepaidFromStrategy(address indexed actor,uint256 requestedAssets,uint256 withdrawnAssets,uint256 burnedShares,uint256 debtBefore,uint256 debtAfter,uint256 strategyAssetsBefore,uint256 strategyAssetsAfter)"]);
const morphoEvent = parseAbi(["event Repay(bytes32 indexed id,address indexed caller,address indexed onBehalf,uint256 assets,uint256 shares)"]);
const vaultEvent = parseAbi(["event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)"]);
const log = (address: Address, topics: readonly unknown[], data: Hex, logIndex: number) => ({ address, topics, data, logIndex });
const receipt = (receiver = account): TransactionReceipt => ({
  status: "success", from: guardian, to: account,
  logs: [
    log(account,
      encodeEventTopics({ abi: strategyEvent, eventName: "RepaidFromStrategy", args: { actor: guardian } }),
      encodeAbiParameters(Array.from({ length: 7 }, () => ({ type: "uint256" })) as never, [25n, 25n, 10n, 100n, 75n, 55n, 30n] as never), 0),
    log(morpho,
      encodeEventTopics({ abi: morphoEvent, eventName: "Repay", args: { id: marketId, caller: account, onBehalf: account } }),
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [25n, 25n]), 1),
    log(vault,
      encodeEventTopics({ abi: vaultEvent, eventName: "Withdraw", args: { sender: account, receiver, owner: account } }),
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [25n, 10n]), 2),
  ],
} as unknown as TransactionReceipt);

const route = { account, guardian, morpho, vault, marketId };

describe("Custos canonical receipt evidence", () => {
  test("decodes the Crest debt delta, own Morpho beneficiary, and fixed Vault V2 withdrawal", () => {
    expect(decodeGuardianReceipt(receipt(), route, "repay_strategy")).toEqual({
      success: true,
      crestEvent: { kind: "repay_strategy", actor: guardian, assets: 25n, debtBefore: 100n, debtAfter: 75n },
      morphoRepay: { beneficiary: account, assets: 25n },
      vaultWithdraw: { owner: account, receiver: account, assets: 25n },
    });
  });

  test("does not hide a vault withdrawal redirected to a different recipient", () => {
    expect(decodeGuardianReceipt(receipt(rogue), route, "repay_strategy").vaultWithdraw?.receiver).toBe(rogue);
  });

  test("rejects a receipt targeted at a different account", () => {
    expect(() => decodeGuardianReceipt({ ...receipt(), to: rogue }, route, "repay_strategy")).toThrow("target");
  });
});
