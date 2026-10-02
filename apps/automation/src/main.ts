import { and, eq } from "drizzle-orm";
import { getAddress, parseAbi } from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { createRobinhoodClient, pinBlock, readCodeHash, robinhoodChainOf } from "@crest/chain";
import { crestAccountAbi } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase, crestAccounts } from "@crest/db";

import { verifyGuardianAuthority } from "./authority.ts";
import { readGuardianState } from "./state.ts";
import { exactRoute, executeGuardianOnce, reconcileGuardianRun } from "./worker.ts";

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

const command = process.argv[2];
if (command !== "doctor" && command !== "run" && command !== "reconcile") {
  console.error("usage: crest-guardian doctor | run --once --trigger-id <id> | reconcile --run-id <id>");
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
    const [registered] = await db.select().from(crestAccounts).where(and(
      eq(crestAccounts.chainId, BigInt(manifest.network.chainId)),
      eq(crestAccounts.address, Buffer.from(account.slice(2), "hex")),
    ));
    if (!registered || registered.status !== "active") throw new Error("Custos doctor requires a registered active Crest Account");
    const head = await pinBlock(rpc, { nowSeconds: BigInt(Math.floor(Date.now() / 1000)), maxHeadLagSeconds: 120n, expectedChainId: manifest.network.chainId });
    if (head.status !== "normal" || head.value === null) throw new Error("Custos doctor requires a fresh canonical head");
    const block = head.value.block;
    const codeHash = `0x${Buffer.from(registered.codeHash).toString("hex")}` as Hex;
    const code = await readCodeHash(rpc, block, account, codeHash);
    const route = exactRoute(manifest, account, expectedGuardian, codeHash);
    const state = await readGuardianState(rpc, block, route);
    const [chainId, owner] = await Promise.all([
      rpc.getChainId(),
      rpc.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner", blockNumber: block.number }),
    ]);
    const report = verifyGuardianAuthority(crestAccountAbi,
      { account, chainId, owner, guardian: state.guardian, borrowingFrozen: state.frozen },
      { expectedGuardian, allowedAccount: account }, manifest.network.chainId,
      { accountCodeHashMatches: code.status === "normal",
        routeQualified: manifest.gate.outcome === "full_route" && state.marketId.toLowerCase() === manifest.market.id.toLowerCase() },
    );
    console.log(JSON.stringify({ service: "crest-guardian", command: "doctor", ...report }, null, 2));
    if (report.status === "failed") process.exitCode = 1;
  } catch {
    console.error("Custos doctor could not verify the registered account, code hash and reviewed route.");
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
  if (command === "run") required("GUARDIAN_PRIVATE_KEY");
  const manifest = await loadDeploymentManifest();
  robinhoodChainOf(chainId);
  if (manifest.network.chainId !== chainId || manifest.gate.outcome !== "full_route") {
    throw new Error("Custos requires GUARDIAN_EXPECTED_CHAIN_ID to match an exact qualified deployment manifest");
  }
  const rpc = createRobinhoodClient(rpcUrl, manifest.network.chainId);
  const { db, client } = createDatabase(databaseUrl);
  try {
    const expected = { account, guardian };
    const result = command === "run"
      ? await executeGuardianOnce(db, rpc, manifest, { ...expected, triggerId: args[2]!,
        loadSigner: () => {
          const key = process.env.GUARDIAN_PRIVATE_KEY;
          if (!/^0x[0-9a-fA-F]{64}$/.test(key ?? "")) throw new Error("GUARDIAN_PRIVATE_KEY must be a 32-byte hex key");
          return privateKeyToAccount(key as Hex);
        } })
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
