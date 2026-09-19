import { createPublicClient, http, parseAbi } from "viem";
import type { Address, Hex } from "viem";

import { loadDeploymentManifest } from "@crest/contracts/manifest/file";

import { observeRoute } from "./observe.ts";
import type { RouteReader } from "./observe.ts";

/**
 * Read-only route monitor. No key is loaded here and no transaction is ever built.
 *
 * Exits non-zero when the live route no longer matches the reviewed manifest, so an operator or CI job
 * treats drift as a stop condition rather than a warning.
 */

const VAULT_ABI = parseAbi(["function asset() view returns (address)"]);

const rpcUrl = process.env.ROBINHOOD_CHAIN_RPC_URL;
if (!rpcUrl) {
  console.error("ROBINHOOD_CHAIN_RPC_URL is required; the monitor refuses to guess an endpoint");
  process.exit(1);
}

const intervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 60_000);
const once = process.argv.includes("--once");
const manifest = await loadDeploymentManifest();
const client = createPublicClient({ transport: http(rpcUrl) });

const reader: RouteReader = {
  getChainId: () => client.getChainId(),
  getBlock: async () => {
    const block = await client.getBlock({ blockTag: "latest" });
    if (block.hash === null) throw new Error("pending block has no hash");
    return { number: block.number, hash: block.hash, timestamp: block.timestamp };
  },
  getCode: (address: Address, blockNumber: bigint): Promise<Hex | undefined> => client.getCode({ address, blockNumber }),
  readVaultAsset: (vault: Address, blockNumber: bigint): Promise<Address> =>
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: "asset", blockNumber }),
};

let drifted = false;
do {
  const observation = await observeRoute(manifest, reader);
  drifted = observation.status === "drifted";
  console.log(JSON.stringify({ service: "crest-monitor", ...observation }));
  if (!once && !drifted) {
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve, intervalMs);
    await tick.promise;
  }
} while (!once && !drifted);

if (drifted) process.exit(1);
