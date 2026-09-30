import { describe, expect, test } from "vitest";
import { keccak256, type Address, type Hex, type PublicClient } from "viem";
import { policyHashOf } from "@crest/policy";
import { readGuardianState } from "./state.ts";

const account = "0x1111111111111111111111111111111111111111" as Address;
const guardian = "0x2222222222222222222222222222222222222222" as Address;
const owner = "0x3333333333333333333333333333333333333333" as Address;
const loanToken = "0x4444444444444444444444444444444444444444" as Address;
const vault = "0x5555555555555555555555555555555555555555" as Address;
const marketId = `0x${"a1".repeat(32)}` as Hex;
const block = { number: 200n, hash: `0x${"b2".repeat(32)}` as Hex, timestamp: 1_700_000_000n };
const codeHash = keccak256("0x6000");
const policy = {
  market: { loanToken, collateralToken: "0x6666666666666666666666666666666666666666" as Address,
    oracle: "0x7777777777777777777777777777777777777777" as Address, irm: "0x8888888888888888888888888888888888888888" as Address, lltv: 625000000000000000n },
  yieldVault: vault, maxCollateralAssets: 1_000n, debtCeilingAssets: 500n, maxStrategyAssets: 500n,
  reserveFloorAssets: 20n, strategyFloorAssets: 10n, maxRepayPerActionAssets: 45n,
  lowerLtvWad: 100n, targetLtvWad: 200n, upperLtvWad: 300n, criticalLtvWad: 400n, guardian,
};
const config = { account, guardian, loanToken, vault, marketId, expectedCodeHash: codeHash,
  expectedMorphoCodeHash: codeHash, expectedVaultCodeHash: codeHash, expectedLoanCodeHash: codeHash,
  morpho: "0x9999999999999999999999999999999999999999" as Address, market: policy.market };

function client(observed: bigint[], wrongCode = false, wrongAddress?: Address, wrongAsset = false,
  degradedVault = false, degradedDebt = false): PublicClient {
  return {
    getCode: async ({ address }: { address: Address }) => {
      if (degradedVault && address === vault) throw new Error("vault RPC unavailable");
      return wrongCode || address === wrongAddress ? "0x6001" : "0x6000";
    },
    readContract: async ({ address, functionName, blockNumber }: { address: Address; functionName: string; blockNumber: bigint }) => {
      if (degradedVault && (functionName === "maxWithdrawableStrategyAssets" || address === vault)) throw new Error("vault adapter unavailable");
      if (degradedDebt && functionName === "currentDebtAssets") throw new Error("Morpho debt read unavailable");
      observed.push(blockNumber);
      switch (functionName) {
        case "policy": return policy;
        case "policyNonce": return 1n;
        case "borrowingFrozen": return false;
        case "owner": return owner;
        case "guardian": return guardian;
        case "marketId": return marketId;
        case "asset": return wrongAsset ? owner : loanToken;
        case "morpho": return config.morpho;
        case "balanceOf": return address.toLowerCase() === vault.toLowerCase() ? 30n : 80n;
        case "currentDebtAssets": return 100n;
        case "strategyAssets": return 50n;
        case "maxWithdrawableStrategyAssets": return 40n;
        default: throw new Error(`unexpected read ${functionName}`);
      }
    },
  } as unknown as PublicClient;
}

describe("Custos pre-sign authority refresh", () => {
  test("pins policy, accrued debt, reserve, shares and withdrawable liquidity to one block", async () => {
    const observed: bigint[] = [];
    const result = await readGuardianState(client(observed), block, config);
    expect(result).toMatchObject({ account, guardian, policyNonce: 1n, policyHash: policyHashOf(policy),
      debtAssets: 100n, reserveAssets: 80n, shares: 30n, strategyAssets: 50n,
      withdrawableAssets: 40n, reserveFloorAssets: 20n, strategyFloorAssets: 10n, maxRepayPerActionAssets: 45n });
    expect(observed).toHaveLength(13);
    expect(observed.every((number) => number === block.number)).toBe(true);
  });

  test("rejects a different account bytecode before any signature", async () => {
    await expect(readGuardianState(client([], true), block, config)).rejects.toThrow("bytecode");
  });
  test("rejects a changed fixed vault bytecode before evaluating repayment liquidity", async () => {
    await expect(readGuardianState(client([], false, vault), block, config)).rejects.toThrow("bytecode");
  });
  test("rejects a vault whose underlying token differs from the reviewed loan token", async () => {
    await expect(readGuardianState(client([], false, undefined, true), block, config)).rejects.toThrow("asset");
  });
  test("still reads enough account authority to freeze when vault liquidity is unavailable", async () => {
    const observed: bigint[] = [];
    const result = await readGuardianState(client(observed, false, undefined, false, true), block, config, "freeze");
    expect(result).toMatchObject({ frozen: false, policyNonce: 1n, debtAssets: null, withdrawableAssets: null });
    expect(observed.every((number) => number === block.number)).toBe(true);
  });
  test("freezes from exact account authority even when Morpho debt reads are unavailable", async () => {
    const result = await readGuardianState(client([], false, undefined, false, false, true), block, config, "freeze");
    expect(result).toMatchObject({ frozen: false, debtAssets: null, guardian });
  });
});
