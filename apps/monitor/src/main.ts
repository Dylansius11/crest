import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";
import { getAddress } from "viem";
import type { Address, Hex } from "viem";

import { createRobinhoodClient, readCodeHash } from "@crest/chain";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase, crestAccounts, indexCrestEvents, networks, persistAssessment } from "@crest/db";
import { parseScenarioSet } from "@crest/risk";

import { collectRiskInput, pinConfirmedBlock } from "./collect.ts";
import { observeRoute } from "./observe.ts";
import { evaluatePoll } from "./poll.ts";
import { persistObservations } from "./persist.ts";
import { loadMonitoredPolicy } from "./registry.ts";

/** Read-only monitor: no signer, wallet, Guardian private key, or transaction preparation exists here. */
const rpcUrl = process.env.ROBINHOOD_CHAIN_RPC_URL;
const databaseUrl = process.env.DATABASE_URL;
const accountEnv = process.env.CREST_ACCOUNT_ADDRESS;
if (!rpcUrl || !databaseUrl || !accountEnv) throw new Error("ROBINHOOD_CHAIN_RPC_URL, DATABASE_URL, and CREST_ACCOUNT_ADDRESS are required");
const accountAddress = getAddress(accountEnv);
const intervalMs = Number(process.env.MONITOR_INTERVAL_MS ?? 60_000);
if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) throw new Error("MONITOR_INTERVAL_MS must be positive milliseconds");
const once = process.argv.includes("--once");
const manifest = await loadDeploymentManifest();
const scenarios = parseScenarioSet(JSON.parse(await readFile(fileURLToPath(new URL("../../../config/scenarios.v2.json", import.meta.url)), "utf8")));
const rpc = createRobinhoodClient(rpcUrl, manifest.network.chainId);
const { db, client: sqlClient } = createDatabase(databaseUrl);

try {
  do {
    const [network] = await db.select().from(networks).where(eq(networks.chainId, BigInt(manifest.network.chainId)));
    if (!network?.enabled) throw new Error("reviewed network is not registered or is disabled");
    const head = await pinConfirmedBlock(rpc, network.confirmationDepth, BigInt(Math.floor(Date.now() / 1000)), 120n, manifest.network.chainId);
    if (head.value === null) throw new Error("confirmed block unavailable");
    const block = head.value.block;
    const [registered] = await db.select().from(crestAccounts).where(and(
      eq(crestAccounts.chainId, BigInt(manifest.network.chainId)),
      eq(crestAccounts.address, Buffer.from(accountAddress.slice(2), "hex")),
    ));
    if (!registered || registered.status !== "active") throw new Error("Crest Account has no active registry row");
    const code = await readCodeHash(rpc, block, accountAddress, `0x${Buffer.from(registered.codeHash).toString("hex")}` as Hex);
    if (code.status !== "normal") throw new Error("Crest Account bytecode disagrees with the registry");
    const route = await observeRoute(manifest, {
      getChainId: () => rpc.getChainId(),
      getBlock: () => Promise.resolve(block),
      getCode: (address: Address, blockNumber: bigint) => rpc.getCode({ address, blockNumber }),
      readVaultAsset: async (vault: Address, blockNumber: bigint) => rpc.readContract({
        address: vault,
        abi: [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
        functionName: "asset",
        blockNumber,
      }),
    });
    if (route.status !== "matched") throw new Error("reviewed route drifted or is unreadable");
    const indexed = await indexCrestEvents({
      db, client: rpc, crestAccountId: registered.id, crestAccountAddress: accountAddress,
      marketId: manifest.market.id as Hex, deploymentBlock: registered.deploymentBlockNumber,
      finalizedBlock: { number: block.number, hash: block.hash },
    });
    const active = await loadMonitoredPolicy(db, manifest, accountAddress, block.number);
    if (indexed.indexedPolicyNonce !== active.nonce) throw new Error("indexed policy nonce disagrees with active policy");
    const input = await collectRiskInput(rpc, manifest, active.compiled, active.nonce, head, indexed.strategyCostBasisAssets, scenarios);
    const evaluation = evaluatePoll(input, {
      accountId: active.accountId, policyId: active.policyId,
      chainId: BigInt(manifest.network.chainId), account: accountAddress, at: new Date(),
    });
    const refs = await persistObservations(db, input, {
      accountId: active.accountId, marketId: Buffer.from(active.compiled.route.marketId.slice(2), "hex"),
      vaultId: active.vaultDeploymentId,
    }, evaluation.strategyActionableAssets);
    await persistAssessment(db, { ...evaluation.assessment, ...refs }, evaluation.trigger);
    console.log(JSON.stringify({
      service: "crest-monitor", chainId: manifest.network.chainId, account: accountAddress,
      blockNumber: block.number.toString(), blockHash: block.hash, assessmentId: evaluation.assessment.id,
      state: evaluation.assessment.status, triggerId: evaluation.trigger?.id ?? null,
      ownerRecommendation: evaluation.assessment.recommendedAction,
    }));
    if (!once) {
      const tick = Promise.withResolvers<void>();
      setTimeout(tick.resolve, intervalMs);
      await tick.promise;
    }
  } while (!once);
} finally {
  await sqlClient.end();
}
