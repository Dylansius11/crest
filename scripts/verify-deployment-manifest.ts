import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { isRecord } from "@crest/contracts/manifest";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import type { DeploymentManifest } from "@crest/contracts/manifest";

// Offline manifest rules live in `@crest/contracts/manifest`; this module adds the onchain drift check and
// the CLI. Re-exported so existing callers and `scripts/verify-deployment-manifest.test.ts` keep one entry point.
export {
  classifyRoute,
  computeManifestIntegrity,
  isDeploymentManifest,
  validateDeploymentManifest,
} from "@crest/contracts/manifest";
export { loadDeploymentManifest } from "@crest/contracts/manifest/file";
export type { ContractEvidence, DeploymentManifest, RouteGateInput } from "@crest/contracts/manifest";



async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method} returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error(`RPC ${method} returned a non-object response`);
  const rpcError = body.error;
  if (isRecord(rpcError)) throw new Error(`RPC ${method}: ${String(rpcError.message ?? "unknown error")}`);
  return body.result;
}

async function rpcHex(url: string, method: string, params: unknown[] = []): Promise<string> {
  const result = await rpc(url, method, params);
  if (typeof result !== "string" || !/^0x[0-9a-fA-F]*$/.test(result)) throw new Error(`RPC ${method} returned invalid hex`);
  return result;
}

function blockTag(number: string): string {
  return `0x${BigInt(number).toString(16)}`;
}

function callData(selector: string, argument?: string): string {
  return argument ? `${selector}${argument.slice(2).padStart(64, "0")}` : selector;
}

async function ethCall(url: string, to: string, data: string, block: string): Promise<string> {
  return rpcHex(url, "eth_call", [{ to, data }, block]);
}

function word(data: string, index = 0): string {
  const start = 2 + index * 64;
  const value = data.slice(start, start + 64);
  if (value.length !== 64) throw new Error(`short ABI result at word ${index}`);
  return value;
}

function abiAddress(data: string, index = 0): string {
  return `0x${word(data, index).slice(24)}`;
}

function abiUint(data: string, index = 0): bigint {
  return BigInt(`0x${word(data, index)}`);
}


function recordMismatch(errors: string[], actual: unknown, expected: unknown, label: string): void {
  if (typeof actual === "string" && typeof expected === "string" && actual.startsWith("0x") && expected.startsWith("0x")) {
    if (actual.toLowerCase() !== expected.toLowerCase()) errors.push(`${label} mismatch`);
  } else if (actual !== expected) errors.push(`${label} mismatch`);
}

export async function verifyDeploymentManifestOnline(manifest: DeploymentManifest, rpcUrl: string): Promise<string[]> {
  const errors: string[] = [];
  // Identity and finality stay anchored to the finalized evidence block header. Robinhood Chain nodes prune
  // historical state and serve account proofs only at the head, so immutable state (code hashes, market
  // params, decimals, vault asset) is re-read at `latest`: that is also the stronger drift check, because a
  // mismatch means the live deployment no longer matches the recorded route.
  const pinnedBlock = blockTag(manifest.evidence.block.number);
  const stateBlock = "latest";
  recordMismatch(errors, Number(BigInt(await rpcHex(rpcUrl, "eth_chainId"))), manifest.network.chainId, "chain ID");

  const block = await rpc(rpcUrl, "eth_getBlockByNumber", [pinnedBlock, false]);
  if (!isRecord(block)) throw new Error("pinned block was not returned");
  recordMismatch(errors, block.hash, manifest.evidence.block.hash, "pinned block hash");
  if (typeof block.timestamp !== "string") errors.push("pinned block timestamp missing");
  else recordMismatch(errors, new Date(Number(BigInt(block.timestamp)) * 1000).toISOString(), manifest.evidence.block.timestamp, "pinned block timestamp");

  for (const [name, contract] of Object.entries(manifest.contracts)) {
    const code = await rpcHex(rpcUrl, "eth_getCode", [contract.address, stateBlock]);
    if (code === "0x") errors.push(`${name} has no code at the pinned block`);
    const proof = await rpc(rpcUrl, "eth_getProof", [contract.address, [], stateBlock]);
    if (!isRecord(proof)) throw new Error(`RPC eth_getProof returned invalid ${name} proof`);
    recordMismatch(errors, proof.codeHash, contract.codeHash, `${name} code hash`);
  }

  const marketParams = await ethCall(rpcUrl, manifest.contracts.morpho.address, callData("0x2c3c9157", manifest.market.id), stateBlock);
  for (const [index, expected, label] of [
    [0, manifest.market.loanToken, "market loan token"],
    [1, manifest.market.collateralToken, "market collateral token"],
    [2, manifest.market.oracle, "market oracle"],
    [3, manifest.market.irm, "market IRM"],
  ] as const) recordMismatch(errors, abiAddress(marketParams, index), expected, label);
  recordMismatch(errors, abiUint(marketParams, 4).toString(), manifest.market.lltv, "market LLTV");

  for (const name of ["loanToken", "collateralToken"] as const) {
    const expected = manifest.contracts[name].decimals;
    recordMismatch(errors, Number(abiUint(await ethCall(rpcUrl, manifest.contracts[name].address, "0x313ce567", stateBlock))), expected, `${name} decimals`);
  }
  // A sandbox oracle may revert (stale or paused mock feed); report it as drift instead of aborting the check.
  const price = await ethCall(rpcUrl, manifest.contracts.oracle.address, "0xa035b1fe", stateBlock).catch((error: unknown) => error);
  if (typeof price !== "string") errors.push(`oracle price() reverted: ${price instanceof Error ? price.message : String(price)}`);
  else if (abiUint(price) === 0n) errors.push("oracle price is zero");
  // Only a reviewed route uses AdaptiveCurveIrm, which exposes MORPHO(); the sandbox MockIRM has no binding.
  if (manifest.trust.level === "reviewed") {
    recordMismatch(errors, abiAddress(await ethCall(rpcUrl, manifest.contracts.irm.address, "0x3acb5624", stateBlock)), manifest.contracts.morpho.address, "IRM Morpho binding");
  }
  recordMismatch(errors, abiAddress(await ethCall(rpcUrl, manifest.vault.address, "0x38d52e0f", stateBlock)), manifest.contracts.loanToken.address, "vault asset");
  recordMismatch(errors, abiAddress(await ethCall(rpcUrl, manifest.vault.address, "0xad468d11", stateBlock)), manifest.vault.governance.liquidityAdapter, "vault liquidity adapter");

  const account = "0x0000000000000000000000000000000000000001";
  for (const [name, selector] of Object.entries({ maxDeposit: "0x402d267d", maxMint: "0xc63d75b6", maxWithdraw: "0xce96cb77", maxRedeem: "0xd905777e" })) {
    const actual = abiUint(await ethCall(rpcUrl, manifest.vault.address, callData(selector, account), stateBlock)).toString();
    recordMismatch(errors, actual, manifest.vault.maxFunctions[name], `vault ${name}`);
  }
  return errors;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const manifestArg = args.indexOf("--manifest");
  const rpcArg = args.indexOf("--rpc");
  const manifest = await loadDeploymentManifest(
    manifestArg >= 0 ? resolve(String(args[manifestArg + 1])) : undefined,
  );

  // Default to the local retrying proxy (`pnpm fork:proxy`), which pins the official endpoint's real IP.
  const rpcUrl = rpcArg >= 0 ? args[rpcArg + 1] : (process.env.CREST_UPSTREAM_RPC ?? "http://127.0.0.1:8599");
  const onlineErrors = args.includes("--offline") ? [] : await verifyDeploymentManifestOnline(manifest, rpcUrl);
  if (onlineErrors.length > 0) throw new Error(onlineErrors.join("\n"));
  const source = args.includes("--offline") ? "offline evidence" : "onchain";
  const trust = manifest.trust.level === "sandbox" ? "SANDBOX " : "";
  console.log(`Verified ${trust}${manifest.gate.outcome} on chain ${manifest.network.chainId} at block ${manifest.evidence.block.number} (${source})`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
