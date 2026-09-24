import { getAddress } from "viem";
import type { Address, Hex } from "viem";

import type { DeploymentManifest } from "@crest/contracts/manifest";
import { marketIdOf, morphoRouteOf } from "@crest/morpho";
import type { MarketParams } from "@crest/morpho";

/**
 * Everything a policy is bound to, taken only from the reviewed manifest plus the account and its owner.
 * A draft never supplies any of it: an owner chooses limits, not the market, vault, oracle, or feeds.
 */
export interface VerifiedRouteContext {
  chainId: number;
  account: Address;
  owner: Address;
  morpho: Address;
  marketId: Hex;
  market: MarketParams;
  vault: Address;
  tokens: { collateralDecimals: number; loanDecimals: number };
  /** The Chainlink feeds inside the market oracle: the inputs to Crest's own feed-only valuation. */
  feeds: { collateral: Address; loan: Address };
}

function evidence(manifest: DeploymentManifest, name: string): { address: Address; decimals: number | undefined } {
  const entry = manifest.contracts[name];
  if (entry === undefined) throw new Error(`deployment manifest has no ${name} contract`);
  return { address: getAddress(entry.address), decimals: entry.decimals };
}

export function routeContextOf(manifest: DeploymentManifest, deployment: { account: Address; owner: Address }): VerifiedRouteContext {
  if (manifest.gate.outcome !== "full_route") {
    throw new Error(`deployment manifest gate is ${manifest.gate.outcome}; a borrowing policy needs full_route`);
  }
  const { morpho, marketId, params } = morphoRouteOf(manifest);
  if (marketIdOf(params) !== marketId.toLowerCase()) throw new Error("manifest market id does not derive from its market parameters");
  const collateral = evidence(manifest, "collateralToken");
  const loan = evidence(manifest, "loanToken");
  if (collateral.address !== params.collateralToken || loan.address !== params.loanToken) {
    throw new Error("manifest token evidence does not match the market parameters");
  }
  if (collateral.decimals === undefined || loan.decimals === undefined) throw new Error("manifest token evidence lacks decimals");
  const vault = getAddress(manifest.vault.address);
  if (getAddress(manifest.vault.asset) !== params.loanToken) throw new Error("manifest vault asset is not the market loan token");
  return {
    chainId: manifest.network.chainId,
    account: getAddress(deployment.account),
    owner: getAddress(deployment.owner),
    morpho,
    marketId: marketId.toLowerCase() as Hex,
    market: params,
    vault,
    tokens: { collateralDecimals: collateral.decimals, loanDecimals: loan.decimals },
    feeds: { collateral: evidence(manifest, "collateralFeed").address, loan: evidence(manifest, "loanFeed").address },
  };
}
