import { getAddress } from "viem";
import type { Hex } from "viem";

import type { DeploymentManifest } from "@crest/contracts/manifest";

import type { VaultRoute } from "./vault.ts";

export { ADAPTER_ABI, allocationIds, readVault, readVaultPosition, simulateWithdrawal, VAULT_V2_ABI } from "./vault.ts";
export type { AllocationCap, VaultPosition, VaultRoute, VaultSnapshot, WithdrawalSimulation } from "./vault.ts";

/** The reviewed vault route, taken only from the validated deployment manifest. */
export function vaultRouteOf(manifest: DeploymentManifest): VaultRoute {
  const morpho = manifest.contracts.morpho;
  const liquidityMarket = manifest.vault.downstreamAllocations.find((entry) => entry.liquidityRole === "default");
  if (morpho === undefined || liquidityMarket === undefined) throw new Error("deployment manifest lacks the vault liquidity route");
  return {
    vault: getAddress(manifest.vault.address),
    codeHash: manifest.vault.codeHash as Hex,
    asset: getAddress(manifest.vault.asset),
    morpho: getAddress(morpho.address),
    liquidityAdapter: getAddress(manifest.vault.governance.liquidityAdapter),
    liquidityMarketId: liquidityMarket.marketId as Hex,
    baselineSharePriceRay: BigInt(manifest.vault.state.sharePriceRay),
  };
}
