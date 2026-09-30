import { describe, expect, test } from "vitest";
import { decodeFunctionData, toFunctionSelector, type Abi } from "viem";
import { crestAccountAbi } from "@crest/contracts";
import { buildGuardianCall } from "./simulate.ts";

const account = "0x1111111111111111111111111111111111111111" as const;

const abi = crestAccountAbi as Abi;

describe("Custos call construction", () => {
  test("only the three fixed Guardian selectors can be encoded", () => {
    const freeze = buildGuardianCall({ kind: "freeze" }, account);
    const reserve = buildGuardianCall({ kind: "repay_reserve", assets: 37n }, account);
    const strategy = buildGuardianCall({ kind: "repay_strategy", assets: 42n }, account);
    expect([freeze.data.slice(0, 10), reserve.data.slice(0, 10), strategy.data.slice(0, 10)])
      .toEqual([toFunctionSelector("freezeBorrowing()"), toFunctionSelector("repayFromReserve(uint256)"), toFunctionSelector("repayFromStrategy(uint256)")]);
    expect(decodeFunctionData({ abi, data: reserve.data })).toMatchObject({ functionName: "repayFromReserve", args: [37n] });
    expect(decodeFunctionData({ abi, data: strategy.data })).toMatchObject({ functionName: "repayFromStrategy", args: [42n] });
    expect([freeze.to, reserve.to, strategy.to]).toEqual([account, account, account]);
    expect(() => buildGuardianCall({ kind: "borrow", assets: 1n } as never, account)).toThrow();
    expect(() => buildGuardianCall({ kind: "repay_reserve", assets: 0n }, account)).toThrow();
  });
});
