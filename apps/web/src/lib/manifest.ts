import { isDeploymentManifest, validateDeploymentManifest } from "@crest/contracts/manifest";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { getAddress } from "viem";
import type { Address } from "viem";

import mainnetRaw from "../../../../config/deployment-manifest.json";
import testnetRaw from "../../../../config/deployment-manifest.46630.json";

/**
 * The chain-tagged routes, bound at build time.
 *
 * Manifests only change through review, so the app compiles them in rather than reading them at request time.
 * Validation runs here: a build can never ship a web app that renders an unreviewed or tampered route, and the
 * validator fixes each chain's trust tier, so the testnet route can only ever render as a SANDBOX.
 */
function bind(raw: unknown, label: string): DeploymentManifest {
  const errors = validateDeploymentManifest(raw);
  if (errors.length > 0 || !isDeploymentManifest(raw)) throw new Error(`invalid ${label} deployment manifest:\n${errors.join("\n")}`);
  return raw;
}

/** The reviewed Robinhood Chain mainnet route. Archived evidence; owner signing stays disabled on it. */
export const mainnetManifest = bind(mainnetRaw, "mainnet");
/** The labeled 46630 SANDBOX route: real testnet transactions on an unreviewed route. */
export const testnetManifest = bind(testnetRaw, "testnet");

const ROUTES = { 4663: mainnetManifest, 46630: testnetManifest } as const;

/** The route the owner workspace reads and signs against; the testnet sandbox unless explicitly overridden. */
export const activeManifest: DeploymentManifest = (() => {
  const selected = Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? 46630);
  if (selected !== 4663 && selected !== 46630) throw new Error(`NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ${String(selected)} has no deployment manifest`);
  return ROUTES[selected];
})();

export type RouteToken = { address: Address; symbol: string; decimals: number };

function routeToken(manifest: DeploymentManifest, name: "collateralToken" | "loanToken"): RouteToken {
  const entry = manifest.contracts[name];
  // `symbol` is recorded evidence outside the shared ContractEvidence shape, so narrow it at runtime.
  const symbol = entry !== undefined && "symbol" in entry && typeof entry.symbol === "string" ? entry.symbol : null;
  if (entry === undefined || symbol === null || entry.decimals === undefined) throw new Error(`${manifest.network.name} manifest is missing ${name} symbol or decimals`);
  return { address: getAddress(entry.address), symbol, decimals: entry.decimals };
}

/** The one collateral and one loan token of the active route, with the manifest's recorded symbol and decimals. */
export const activeTokens = {
  collateral: routeToken(activeManifest, "collateralToken"),
  loan: routeToken(activeManifest, "loanToken"),
} as const;
