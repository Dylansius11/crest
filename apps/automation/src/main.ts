import { readFile, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { getAddress, isHex, parseAbi } from "viem";
import type { Hex, PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createRobinhoodClient, pinBlock, readCodeHash, robinhoodChainOf } from "@crest/chain";
import { crestAccountAbi } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { createDatabase, crestAccounts, automationRuns, automationTriggers, policies, latestGuardianTriggerId, type CrestDatabase } from "@crest/db";

import { guardianRuntimeSigningAllowed, verifyGuardianAuthority } from "./authority.ts";
import { readGuardianState } from "./state.ts";
import { exactRoute, executeGuardianOnce, reconcileGuardianRun } from "./worker.ts";
import { watchGuardian } from "./watch.ts";

async function checkAuthority(db: CrestDatabase, rpc: PublicClient, manifest: DeploymentManifest, account: `0x${string}`, guardian: `0x${string}`) {
  const [registered] = await db.select().from(crestAccounts).where(and(
    eq(crestAccounts.chainId, BigInt(manifest.network.chainId)),
    eq(crestAccounts.address, Buffer.from(account.slice(2), "hex")),
  ));
  if (!registered || registered.status !== "active") throw new Error("Custos requires a registered active Crest Account");
  const head = await pinBlock(rpc, { nowSeconds: BigInt(Math.floor(Date.now() / 1000)), maxHeadLagSeconds: 120n, expectedChainId: manifest.network.chainId });
  if (head.status !== "normal" || head.value === null) throw new Error("Custos requires a fresh canonical head");
  const block = head.value.block;
  const codeHash: Hex = `0x${Buffer.from(registered.codeHash).toString("hex")}`;
  const code = await readCodeHash(rpc, block, account, codeHash);
  const route = exactRoute(manifest, account, guardian, codeHash);
  const state = await readGuardianState(rpc, block, route);
  const [chainId, owner] = await Promise.all([
    rpc.getChainId(),
    rpc.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner", blockNumber: block.number }),
  ]);
  return verifyGuardianAuthority(crestAccountAbi,
    { account, chainId, owner, guardian: state.guardian, borrowingFrozen: state.frozen },
    { expectedGuardian: guardian, allowedAccount: account }, manifest.network.chainId,
    { accountCodeHashMatches: code.status === "normal",
      routeQualified: manifest.gate.outcome === "full_route" && state.marketId.toLowerCase() === manifest.market.id.toLowerCase(),
      runtimeSigningAllowed: guardianRuntimeSigningAllowed(manifest) },
  );
}

const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function guardian() view returns (address)",
  "function borrowingFrozen() view returns (bool)",
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required; the Guardian CLI refuses to infer it`);
    process.exit(1);
  }
  return value;
}
function loadSigner() {
  const key = process.env.GUARDIAN_PRIVATE_KEY;
  if (!key || !isHex(key) || key.length !== 66) throw new Error("GUARDIAN_PRIVATE_KEY must be a 32-byte hex key");
  return privateKeyToAccount(key);
}

function pollInterval(): number {
  const interval = Number(process.env.GUARDIAN_POLL_INTERVAL_MS ?? "30000");
  if (!Number.isSafeInteger(interval) || interval <= 0) throw new Error("GUARDIAN_POLL_INTERVAL_MS must be a positive integer");
  return interval;
}


const command = process.argv[2];
if (command !== "doctor" && command !== "run" && command !== "reconcile" && command !== "watch" && command !== "health") {
  console.error("usage: crest-guardian doctor | run --once --trigger-id <id> | reconcile --run-id <id> | watch | health");
  process.exit(1);
}

if (command === "doctor") {
  const rpcUrl = required("ROBINHOOD_CHAIN_RPC_URL");
  const databaseUrl = required("DATABASE_URL");
  const expectedGuardian = getAddress(required("GUARDIAN_EXPECTED_ADDRESS"));
  const account = getAddress(required("GUARDIAN_ALLOWED_ACCOUNT"));
  const expectedChainId = Number(required("GUARDIAN_EXPECTED_CHAIN_ID"));
  const manifest = await loadDeploymentManifest();
  robinhoodChainOf(expectedChainId);
  if (manifest.network.chainId !== expectedChainId || manifest.gate.outcome !== "full_route") {
    throw new Error("Custos requires GUARDIAN_EXPECTED_CHAIN_ID to match an exact qualified deployment manifest");
  }
  const rpc = createRobinhoodClient(rpcUrl, manifest.network.chainId);
  const { db, client } = createDatabase(databaseUrl);
  try {
    const report = await checkAuthority(db, rpc, manifest, account, expectedGuardian);
    console.log(JSON.stringify({ service: "crest-guardian", command: "doctor", ...report }, null, 2));
    if (report.status === "failed") process.exitCode = 1;
  } catch {
    console.error("Custos doctor could not verify the registered account, code hash and reviewed route.");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
} else if (command === "health") {
  try {
    const file = required("GUARDIAN_HEARTBEAT_FILE");
    const timestamp = Number(await readFile(file, "utf8"));
    if (!Number.isFinite(timestamp) || timestamp <= 0 || Date.now() - timestamp > 3 * pollInterval() || timestamp > Date.now()) {
      throw new Error("Custos heartbeat is stale");
    }
  } catch {
    console.error("Custos heartbeat is absent or stale");
    process.exitCode = 1;
  }
} else if (command === "watch") {
  const rpcUrl = required("ROBINHOOD_CHAIN_RPC_URL");
  const databaseUrl = required("DATABASE_URL");
  const chainId = Number(required("GUARDIAN_EXPECTED_CHAIN_ID"));
  const account = getAddress(required("GUARDIAN_ALLOWED_ACCOUNT"));
  const guardian = getAddress(required("GUARDIAN_EXPECTED_ADDRESS"));
  required("DEPLOYMENT_MANIFEST_PATH");
  const intervalMs = pollInterval();
  const manifest = await loadDeploymentManifest();
  robinhoodChainOf(chainId);
  if (!guardianRuntimeSigningAllowed(manifest)) throw new Error("Custos runtime signing is disabled outside the 46630 sandbox");
  if (manifest.network.chainId !== chainId || manifest.gate.outcome !== "full_route") {
    throw new Error("Custos requires GUARDIAN_EXPECTED_CHAIN_ID to match an exact qualified deployment manifest");
  }
  const rpc = createRobinhoodClient(rpcUrl, manifest.network.chainId);
  const { db, client } = createDatabase(databaseUrl);
  const shutdown = new AbortController();
  process.on("SIGTERM", () => shutdown.abort());
  process.on("SIGINT", () => shutdown.abort());
  try {
    process.exitCode = await watchGuardian({
      authority: async () => {
        const report = await checkAuthority(db, rpc, manifest, account, guardian);
        if (report.status === "ok") required("GUARDIAN_PRIVATE_KEY");
        return report.status === "ok";
      },
      runs: async () => db.select({ runId: automationRuns.id, status: automationRuns.status })
        .from(automationRuns)
        .innerJoin(automationTriggers, eq(automationTriggers.id, automationRuns.triggerId))
        .innerJoin(policies, eq(policies.id, automationTriggers.policyId))
        .innerJoin(crestAccounts, eq(crestAccounts.id, policies.crestAccountId))
        .where(and(eq(automationRuns.guardianAddress, Buffer.from(guardian.slice(2), "hex")),
          eq(crestAccounts.address, Buffer.from(account.slice(2), "hex")),
          eq(crestAccounts.chainId, BigInt(chainId)),
          inArray(automationRuns.status, ["claimed", "signed", "broadcast", "reorg_conflict"])))
        .orderBy(automationRuns.startedAt, automationRuns.id),
      reconcile: (runId) => reconcileGuardianRun(db, rpc, manifest, runId, { account, guardian }),
      latestTrigger: () => latestGuardianTriggerId(db, { chainId: BigInt(chainId), accountAddress: account, guardianAddress: guardian, now: new Date() }),
      execute: (triggerId) => executeGuardianOnce(db, rpc, manifest, { triggerId, account, guardian, loadSigner }),
      heartbeat: async () => {
        if (process.env.GUARDIAN_HEARTBEAT_FILE) await writeFile(process.env.GUARDIAN_HEARTBEAT_FILE, String(Date.now()));
      },
      log: (record) => console.log(JSON.stringify(record)),
      sleep: async (ms) => {
        try { await setTimeout(ms, undefined, { signal: shutdown.signal }); } catch {
          if (!shutdown.signal.aborted) throw new Error("Custos interval timer failed");
        }
      },
      stopped: () => shutdown.signal.aborted,
      intervalMs,
    });
  } catch {
    console.error(JSON.stringify({ service: "crest-guardian", result: "failed", error: "startup_authority_unavailable" }));
    process.exitCode = 1;
  } finally {
    await client.end();
  }
} else {
  const flag = command === "run" ? "--trigger-id" : "--run-id";
  const args = process.argv.slice(3);
  const valid = command === "run"
    ? args.length === 3 && args[0] === "--once" && args[1] === flag && !!args[2]
    : args.length === 2 && args[0] === flag && !!args[1];
  if (!valid) {
    console.error(`usage: crest-guardian ${command} ${command === "run" ? "--once " : ""}${flag} <id>`);
    process.exit(1);
  }
  const rpcUrl = required("ROBINHOOD_CHAIN_RPC_URL");
  const databaseUrl = required("DATABASE_URL");
  const chainId = Number(required("GUARDIAN_EXPECTED_CHAIN_ID"));
  const account = getAddress(required("GUARDIAN_ALLOWED_ACCOUNT"));
  const guardian = getAddress(required("GUARDIAN_EXPECTED_ADDRESS"));
  const manifest = await loadDeploymentManifest();
  robinhoodChainOf(chainId);
  if (command === "run" && !guardianRuntimeSigningAllowed(manifest)) {
    throw new Error("Custos runtime signing is disabled outside the 46630 sandbox");
  }
  if (manifest.network.chainId !== chainId || manifest.gate.outcome !== "full_route") {
    throw new Error("Custos requires GUARDIAN_EXPECTED_CHAIN_ID to match an exact qualified deployment manifest");
  }
  if (command === "run") required("GUARDIAN_PRIVATE_KEY");
  const rpc = createRobinhoodClient(rpcUrl, manifest.network.chainId);
  const { db, client } = createDatabase(databaseUrl);
  try {
    const expected = { account, guardian };
    const result = command === "run"
      ? await executeGuardianOnce(db, rpc, manifest, { ...expected, triggerId: args[2]!, loadSigner })
      : await reconcileGuardianRun(db, rpc, manifest, args[1]!, expected);
    console.log(JSON.stringify({ service: "crest-guardian", command, ...expected,
      chainId, ...(result ?? { status: "no_pending" }) }));
    if (!result || result.status === "failed" || result.status === "uncertain") process.exitCode = 1;
  } catch {
    console.error("Custos execution failed; no transaction was retried. Inspect persisted run and RPC before explicit reconciliation.");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
