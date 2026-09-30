import { parseAbi, type Address, type Hex, type PublicClient } from "viem";
import { CREST_ACCOUNT_ABI, readCodeHash, readCrestAccount } from "@crest/chain";
import type { BlockRef } from "@crest/domain";
import { policyHashOf, type PolicyConfig } from "@crest/policy";
import type { GuardianState } from "./validate.ts";

const accountViews = parseAbi([
  "function morpho() view returns (address)",
  "function currentDebtAssets() view returns (uint256)",
  "function strategyAssets() view returns (uint256)",
  "function maxWithdrawableStrategyAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function asset() view returns (address)",
]);

export interface GuardianRoute {
  account: Address;
  guardian: Address;
  loanToken: Address;
  vault: Address;
  morpho: Address;
  marketId: Hex;
  market: { loanToken: Address; collateralToken: Address; oracle: Address; irm: Address; lltv: bigint };
  expectedCodeHash: Hex;
  expectedMorphoCodeHash: Hex;
  expectedVaultCodeHash: Hex;
  expectedLoanCodeHash: Hex;
}

/** Every value comes from one numbered block; unavailable, drifting or unqualified authority fails closed. */
export async function readGuardianState(client: PublicClient, block: BlockRef, route: GuardianRoute,
  mode: "freeze" | "repay" = "repay"): Promise<GuardianState> {
  if (mode === "freeze") {
    const code = await readCodeHash(client, block, route.account, route.expectedCodeHash);
    if (code.status !== "normal") throw new Error("Guardian account bytecode disagrees with registry");
    const [policy, policyNonce, frozen, guardian, marketId, morpho] = await Promise.all([
      client.readContract({ address: route.account, abi: CREST_ACCOUNT_ABI, functionName: "policy", blockNumber: block.number }),
      client.readContract({ address: route.account, abi: CREST_ACCOUNT_ABI, functionName: "policyNonce", blockNumber: block.number }),
      client.readContract({ address: route.account, abi: CREST_ACCOUNT_ABI, functionName: "borrowingFrozen", blockNumber: block.number }),
      client.readContract({ address: route.account, abi: CREST_ACCOUNT_ABI, functionName: "guardian", blockNumber: block.number }),
      client.readContract({ address: route.account, abi: CREST_ACCOUNT_ABI, functionName: "marketId", blockNumber: block.number }),
      client.readContract({ address: route.account, abi: accountViews, functionName: "morpho", blockNumber: block.number }),
    ]);
    if (guardian.toLowerCase() !== policy.guardian.toLowerCase() || !sameRoute(policy, marketId, morpho, route)) {
      throw new Error("Guardian onchain authority or route disagrees with reviewed registry");
    }
    return { block, account: route.account, guardian, policyNonce, policyHash: policyHashOf(policy),
      marketId, vault: policy.yieldVault, debtAssets: null, reserveAssets: null, shares: null,
      strategyAssets: null, withdrawableAssets: null, frozen,
      reserveFloorAssets: policy.reserveFloorAssets, strategyFloorAssets: policy.strategyFloorAssets,
      maxRepayPerActionAssets: policy.maxRepayPerActionAssets };
  }
  const hashes = await Promise.all([
    readCodeHash(client, block, route.account, route.expectedCodeHash),
    readCodeHash(client, block, route.morpho, route.expectedMorphoCodeHash),
    readCodeHash(client, block, route.vault, route.expectedVaultCodeHash),
    readCodeHash(client, block, route.loanToken, route.expectedLoanCodeHash),
  ]);
  if (hashes.some((code) => code.status !== "normal")) throw new Error("Guardian route bytecode disagrees with reviewed registry");
  const [account, morpho, debtAssets, strategyAssets, withdrawableAssets, shares, vaultAsset] = await Promise.all([
    readCrestAccount(client, block, route.account, route.loanToken),
    client.readContract({ address: route.account, abi: accountViews, functionName: "morpho", blockNumber: block.number }),
    client.readContract({ address: route.account, abi: accountViews, functionName: "currentDebtAssets", blockNumber: block.number }),
    client.readContract({ address: route.account, abi: accountViews, functionName: "strategyAssets", blockNumber: block.number }),
    client.readContract({ address: route.account, abi: accountViews, functionName: "maxWithdrawableStrategyAssets", blockNumber: block.number }),
    client.readContract({ address: route.vault, abi: accountViews, functionName: "balanceOf", args: [route.account], blockNumber: block.number }),
    client.readContract({ address: route.vault, abi: accountViews, functionName: "asset", blockNumber: block.number }),
  ]);
  if (vaultAsset.toLowerCase() !== route.loanToken.toLowerCase()) throw new Error("Guardian vault asset disagrees with reviewed loan token");
  if (account.status !== "normal" || account.value === null) throw new Error("Guardian account authority is unreadable or degraded");
  const { policy } = account.value;
  if (!sameRoute(policy, policy.marketId, morpho, route)) {
    throw new Error("Guardian onchain route disagrees with reviewed market and vault");
  }
  return {
    block, account: route.account, guardian: policy.guardian, policyNonce: account.value.policyNonce,
    policyHash: policyHashOf(policy), marketId: policy.marketId, vault: policy.yieldVault,
    debtAssets, reserveAssets: account.value.idleReserveAssets, shares, strategyAssets,
    withdrawableAssets, frozen: account.value.borrowingFrozen,
    reserveFloorAssets: policy.reserveFloorAssets, strategyFloorAssets: policy.strategyFloorAssets,
    maxRepayPerActionAssets: policy.maxRepayPerActionAssets,
  };
}

function sameRoute(policy: PolicyConfig, marketId: Hex, morpho: Address, route: GuardianRoute): boolean {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return same(morpho, route.morpho) && same(marketId, route.marketId) && same(policy.yieldVault, route.vault)
    && same(policy.market.loanToken, route.market.loanToken) && same(policy.market.collateralToken, route.market.collateralToken)
    && same(policy.market.oracle, route.market.oracle) && same(policy.market.irm, route.market.irm)
    && policy.market.lltv === route.market.lltv;
}
