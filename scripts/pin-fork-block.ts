import { readFile, writeFile } from "node:fs/promises";
import { computeManifestIntegrity, validateDeploymentManifest } from "./verify-deployment-manifest.ts";

/**
 * Repins `forkProof` to a block whose state the public Robinhood Chain pool still serves.
 *
 * Head blocks are not yet replicated across the pool and blocks far behind head are pruned, so the pinned
 * lifecycle block is chosen at a fixed depth behind head. Finalized route evidence is never touched here.
 */

const MANIFEST_PATH = process.env.CREST_MANIFEST_PATH ?? "config/deployment-manifest.json";
const RPC = process.env.CREST_UPSTREAM_RPC ?? "https://rpc.ordofi.network";
const DEPTH = Number(process.env.CREST_PIN_DEPTH ?? 512);

async function rpc(method: string, params: unknown[]): Promise<Record<string, unknown>> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (payload.error) throw new Error(`${method}: ${payload.error.message ?? "rpc error"}`);
  if (payload.result === null || typeof payload.result !== "object") throw new Error(`${method}: no block returned`);
  return payload.result as Record<string, unknown>;
}

const head = await rpc("eth_getBlockByNumber", ["latest", false]);
const pinned = BigInt(String(head.number)) - BigInt(DEPTH);
const block = await rpc("eth_getBlockByNumber", [`0x${pinned.toString(16)}`, false]);

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Record<string, unknown>;
const forkProof = manifest.forkProof as Record<string, unknown>;
const evidenceBlock = BigInt(String((((manifest.evidence as Record<string, unknown>).block) as Record<string, unknown>).number));
if (pinned < evidenceBlock) throw new Error(`pinned block ${pinned} precedes evidence block ${evidenceBlock}`);

forkProof.blockNumber = pinned.toString();
forkProof.blockHash = String(block.hash);
// Provenance stays the public endpoint even when reads are served through the local retrying proxy.
forkProof.rpcSource = process.env.CREST_PIN_RPC_SOURCE ?? forkProof.rpcSource;
manifest.integrity = { algorithm: "sha256", digest: computeManifestIntegrity(manifest) };

const errors = validateDeploymentManifest(manifest);
if (errors.length > 0) throw new Error(`manifest invalid after repin:\n${errors.join("\n")}`);

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`pinned forkProof to block ${pinned} (${String(block.hash)}) at depth ${DEPTH} behind head`);
