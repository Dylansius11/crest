import { getAddress } from "viem";
import type { Hex } from "viem";

import type { DeploymentManifest } from "@crest/contracts/manifest";

import type { MorphoRoute } from "./market.ts";

export { accrueInterest, toAssetsUp, toSharesDown, WAD, wTaylorCompounded } from "./math.ts";
export type { MarketState } from "./math.ts";
export { ERC20_BALANCE_ABI, IRM_ABI, MORPHO_ABI, marketIdOf, readMarket, readPosition } from "./market.ts";
export type { MarketParams, MarketSnapshot, MorphoRoute, PositionSnapshot } from "./market.ts";

/**
 * The reviewed market, taken only from the validated deployment manifest. Addresses pass through EIP-55
 * validation here, so a mis-cased manifest entry fails at binding instead of deep inside a read.
 */
export function morphoRouteOf(manifest: DeploymentManifest): MorphoRoute {
  const morpho = manifest.contracts.morpho;
  if (morpho === undefined) throw new Error("deployment manifest has no Morpho contract");
  return {
    morpho: getAddress(morpho.address),
    marketId: manifest.market.id as Hex,
    params: {
      loanToken: getAddress(manifest.market.loanToken),
      collateralToken: getAddress(manifest.market.collateralToken),
      oracle: getAddress(manifest.market.oracle),
      irm: getAddress(manifest.market.irm),
      lltv: BigInt(manifest.market.lltv),
    },
  };
}
