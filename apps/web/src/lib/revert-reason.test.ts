import { crestAccountAbi } from "@crest/contracts";
import { BaseError, RpcRequestError, encodeErrorResult } from "viem";
import type { Abi, Hex } from "viem";
import { describe, expect, test } from "vitest";

import { revertReason } from "./revert-reason";

/** The shape viem raises for a reverted `eth_call`: a short message, with the revert payload on the RPC cause. */
function reverted(data: Hex) {
  return new BaseError("Execution reverted for an unknown reason.", {
    cause: new RpcRequestError({ body: {}, error: { code: 3, message: "execution reverted", data }, url: "https://rpc.invalid" }),
  });
}

describe("revert reason", () => {
  test("names a breached cap in the units of the token it caps", () => {
    const debt = encodeErrorResult({ abi: crestAccountAbi as Abi, errorName: "DebtCeilingExceeded", args: [30_000000n, 49_000000n] });
    expect(revertReason(reverted(debt))).toBe("Debt ceiling exceeded: ceiling 30 USDG, debt would reach 49 USDG");
    const collateral = encodeErrorResult({ abi: crestAccountAbi as Abi, errorName: "CollateralCapExceeded", args: [10n ** 18n, 2n * 10n ** 18n] });
    expect(revertReason(reverted(collateral))).toBe("Collateral cap exceeded: cap 1 TSLA, would reach 2 TSLA");
  });

  test("a revert the account did not raise keeps viem's short message", () => {
    expect(revertReason(reverted("0xdeadbeef"))).toBe("Execution reverted for an unknown reason.");
  });
});
