import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, toFunctionSelector } from "viem";
import type { Address, Hex } from "viem";

import type { MarketParams } from "@crest/morpho";

/** `CrestAccount.configure`. A test pins its selector to the generated contract artifact, so drift fails CI. */
export const CONFIGURE_ABI = parseAbi([
  "struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }",
  "struct PolicyConfig { MarketParams market; address yieldVault; uint128 maxCollateralAssets; uint128 debtCeilingAssets; uint128 maxStrategyAssets; uint128 reserveFloorAssets; uint128 strategyFloorAssets; uint128 maxRepayPerActionAssets; uint64 lowerLtvWad; uint64 targetLtvWad; uint64 upperLtvWad; uint64 criticalLtvWad; address guardian; }",
  "function configure(PolicyConfig c)",
]);

/** The exact onchain `CrestAccount.PolicyConfig` struct. */
export interface PolicyConfig {
  market: MarketParams;
  yieldVault: Address;
  maxCollateralAssets: bigint;
  debtCeilingAssets: bigint;
  maxStrategyAssets: bigint;
  reserveFloorAssets: bigint;
  strategyFloorAssets: bigint;
  maxRepayPerActionAssets: bigint;
  lowerLtvWad: bigint;
  targetLtvWad: bigint;
  upperLtvWad: bigint;
  criticalLtvWad: bigint;
  guardian: Address;
}

/** An unsigned owner transaction. Preparing it proves nothing onchain; it must be simulated, then signed by the owner. */
export interface PreparedOwnerTransaction {
  chainId: number;
  from: Address;
  to: Address;
  value: bigint;
  data: Hex;
  functionName: "configure";
  selector: Hex;
  /** `keccak256(abi.encode(PolicyConfig))`: the value `PolicyConfigured.policyHash` must carry once mined. */
  policyHash: Hex;
}

export function policyHashOf(config: PolicyConfig): Hex {
  return keccak256(encodeAbiParameters(CONFIGURE_ABI[0].inputs, [config]));
}

/** The one owner call that activates a compiled policy. It is addressed only to the account the policy was compiled for. */
export function toConfigurationCall(policy: { route: { chainId: number; owner: Address; account: Address }; config: PolicyConfig; policyHash: Hex }): PreparedOwnerTransaction {
  return {
    chainId: policy.route.chainId,
    from: policy.route.owner,
    to: policy.route.account,
    value: 0n,
    data: encodeFunctionData({ abi: CONFIGURE_ABI, functionName: "configure", args: [policy.config] }),
    functionName: "configure",
    selector: toFunctionSelector(CONFIGURE_ABI[0]),
    policyHash: policy.policyHash,
  };
}
