import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
const ROBINHOOD_CHAIN_ID = 4663;

export interface ContractEvidence {
  address: string;
  codeHash: string;
  decimals?: number;
}

export interface DeploymentManifest {
  schemaVersion: number;
  network: { chainId: number; name: string };
  evidence: {
    retrievedAt: string;
    block: { number: string; hash: string; timestamp: string; finality: "finalized" };
  };
  contracts: Record<string, ContractEvidence>;
  market: {
    id: string;
    derivedId: string;
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: string;
    liquidityAssets: string;
    plannedBorrowAssets: string;
  };
  vault: {
    address: string;
    codeHash: string;
    asset: string;
    generation: string;
    maxFunctions: Record<string, string>;
    withdrawableAssets: string;
    plannedWithdrawalAssets: string;
  };
  forkProof: {
    blockNumber: string;
    blockHash: string;
    morphoLifecycle: "passed" | "failed" | "not_executed";
    vaultLifecycle: "passed" | "failed" | "not_executed";
  };
  gate: {
    outcome: "stop" | "reserve_only" | "full_route";
    marketGate: "passed" | "failed";
    vaultGate: "passed" | "failed" | "not_evaluated";
  };
  integrity: { algorithm: string; digest: string };
}

export interface RouteGateInput {
  marketVerified: boolean;
  marketLiquidityAssets: bigint;
  plannedBorrowAssets: bigint;
  vaultVerified: boolean;
  vaultWithdrawableAssets: bigint;
  plannedWithdrawalAssets: bigint;
}

export function classifyRoute(input: RouteGateInput): DeploymentManifest["gate"]["outcome"] {
  if (!input.marketVerified || input.marketLiquidityAssets < input.plannedBorrowAssets) return "stop";
  if (!input.vaultVerified || input.vaultWithdrawableAssets < input.plannedWithdrawalAssets) return "reserve_only";
  return "full_route";
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([key]) => key !== "integrity")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

export function computeManifestIntegrity(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function sameAddress(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

function requirePattern(errors: string[], value: unknown, pattern: RegExp, path: string): void {
  if (typeof value !== "string" || !pattern.test(value)) errors.push(`${path} is invalid`);
}

const REQUIRED_CONTRACTS = ["morpho", "loanToken", "collateralToken", "oracle", "irm"] as const;

export function validateDeploymentManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["manifest must be an object"];

  if (at(value, "schemaVersion") !== 1) errors.push("schemaVersion must be 1");
  if (at(value, "network", "chainId") !== ROBINHOOD_CHAIN_ID) errors.push("network.chainId must be 4663");
  requirePattern(errors, at(value, "evidence", "block", "number"), UINT, "evidence.block.number");
  requirePattern(errors, at(value, "evidence", "block", "hash"), HASH, "evidence.block.hash");
  if (at(value, "evidence", "block", "finality") !== "finalized") errors.push("evidence.block.finality must be finalized");

  for (const name of REQUIRED_CONTRACTS) {
    requirePattern(errors, at(value, "contracts", name, "address"), ADDRESS, `contracts.${name}.address`);
    requirePattern(errors, at(value, "contracts", name, "codeHash"), HASH, `contracts.${name}.codeHash`);
  }

  requirePattern(errors, at(value, "market", "id"), HASH, "market.id");
  requirePattern(errors, at(value, "market", "derivedId"), HASH, "market.derivedId");
  for (const key of ["lltv", "liquidityAssets", "plannedBorrowAssets"] as const) {
    requirePattern(errors, at(value, "market", key), UINT, `market.${key}`);
  }
  for (const key of ["address", "asset"] as const) requirePattern(errors, at(value, "vault", key), ADDRESS, `vault.${key}`);
  requirePattern(errors, at(value, "vault", "codeHash"), HASH, "vault.codeHash");
  for (const key of ["withdrawableAssets", "plannedWithdrawalAssets"] as const) {
    requirePattern(errors, at(value, "vault", key), UINT, `vault.${key}`);
  }

  if (at(value, "market", "id") !== at(value, "market", "derivedId")) errors.push("market.id does not match derivedId");
  if (!sameAddress(at(value, "market", "loanToken"), at(value, "contracts", "loanToken", "address"))) errors.push("market loan token mismatch");
  if (!sameAddress(at(value, "market", "collateralToken"), at(value, "contracts", "collateralToken", "address"))) errors.push("market collateral token mismatch");
  if (!sameAddress(at(value, "market", "oracle"), at(value, "contracts", "oracle", "address"))) errors.push("market oracle mismatch");
  if (!sameAddress(at(value, "market", "irm"), at(value, "contracts", "irm", "address"))) errors.push("market IRM mismatch");
  if (!sameAddress(at(value, "vault", "asset"), at(value, "contracts", "loanToken", "address"))) errors.push("vault asset is not the market loan token");
  if (!sameAddress(at(value, "vault", "address"), at(value, "contracts", "vault", "address") ?? at(value, "vault", "address"))) errors.push("vault address mismatch");

  // The fork proof runs at or after the finalized evidence block: state at older blocks is pruned by public
  // nodes, so the lifecycle is simulated at a later pinned block while identities stay bound to the evidence.
  const evidenceNumber = at(value, "evidence", "block", "number");
  const forkNumber = at(value, "forkProof", "blockNumber");
  requirePattern(errors, forkNumber, UINT, "forkProof.blockNumber");
  requirePattern(errors, at(value, "forkProof", "blockHash"), HASH, "forkProof.blockHash");
  if (typeof evidenceNumber === "string" && typeof forkNumber === "string" && UINT.test(evidenceNumber) && UINT.test(forkNumber)) {
    if (BigInt(forkNumber) < BigInt(evidenceNumber)) errors.push("fork proof block precedes the evidence block");
  }
  const marketGate = at(value, "gate", "marketGate");
  const vaultGate = at(value, "gate", "vaultGate");
  const morphoLifecycle = at(value, "forkProof", "morphoLifecycle");
  const vaultLifecycle = at(value, "forkProof", "vaultLifecycle");
  if (marketGate !== "passed" && marketGate !== "failed") errors.push("gate.marketGate must be passed or failed");
  if (vaultGate !== "passed" && vaultGate !== "failed" && vaultGate !== "not_evaluated") errors.push("gate.vaultGate is invalid");
  if (morphoLifecycle !== "passed" && morphoLifecycle !== "failed" && morphoLifecycle !== "not_executed") errors.push("forkProof.morphoLifecycle is invalid");
  if (vaultLifecycle !== "passed" && vaultLifecycle !== "failed" && vaultLifecycle !== "not_executed") errors.push("forkProof.vaultLifecycle is invalid");
  if (marketGate === "passed" && morphoLifecycle !== "passed") errors.push("passed market gate requires a passed Morpho fork lifecycle");
  if (vaultGate === "passed" && vaultLifecycle !== "passed") errors.push("passed vault gate requires a passed vault fork lifecycle");

  const marketLiquidity = at(value, "market", "liquidityAssets");
  const plannedBorrow = at(value, "market", "plannedBorrowAssets");
  const vaultLiquidity = at(value, "vault", "withdrawableAssets");
  const plannedWithdrawal = at(value, "vault", "plannedWithdrawalAssets");
  if (
    typeof marketLiquidity === "string" && UINT.test(marketLiquidity)
    && typeof plannedBorrow === "string" && UINT.test(plannedBorrow)
    && typeof vaultLiquidity === "string" && UINT.test(vaultLiquidity)
    && typeof plannedWithdrawal === "string" && UINT.test(plannedWithdrawal)
  ) {
    const expected = classifyRoute({
      marketVerified: marketGate === "passed" && morphoLifecycle === "passed",
      marketLiquidityAssets: BigInt(marketLiquidity),
      plannedBorrowAssets: BigInt(plannedBorrow),
      vaultVerified: vaultGate === "passed" && vaultLifecycle === "passed",
      vaultWithdrawableAssets: BigInt(vaultLiquidity),
      plannedWithdrawalAssets: BigInt(plannedWithdrawal),
    });
    if (at(value, "gate", "outcome") !== expected) errors.push(`gate outcome must be ${expected}`);
  }

  if (at(value, "integrity", "algorithm") !== "sha256") errors.push("integrity.algorithm must be sha256");
  if (at(value, "integrity", "digest") !== computeManifestIntegrity(value)) errors.push("manifest integrity mismatch");
  return errors;
}

export function isDeploymentManifest(value: unknown): value is DeploymentManifest {
  return validateDeploymentManifest(value).length === 0;
}


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
  if (abiUint(await ethCall(rpcUrl, manifest.contracts.oracle.address, "0xa035b1fe", stateBlock)) === 0n) errors.push("oracle price is zero");
  recordMismatch(errors, abiAddress(await ethCall(rpcUrl, manifest.contracts.irm.address, "0x3acb5624", stateBlock)), manifest.contracts.morpho.address, "IRM Morpho binding");
  recordMismatch(errors, abiAddress(await ethCall(rpcUrl, manifest.vault.address, "0x38d52e0f", stateBlock)), manifest.contracts.loanToken.address, "vault asset");

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
  const manifestPath = resolve(manifestArg >= 0 ? args[manifestArg + 1] : "config/deployment-manifest.json");
  const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  const localErrors = validateDeploymentManifest(raw);
  if (localErrors.length > 0 || !isDeploymentManifest(raw)) throw new Error(localErrors.join("\n"));

  const onlineErrors = args.includes("--offline")
    ? []
    : await verifyDeploymentManifestOnline(raw, rpcArg >= 0 ? args[rpcArg + 1] : "https://rpc.mainnet.chain.robinhood.com");
  if (onlineErrors.length > 0) throw new Error(onlineErrors.join("\n"));
  console.log(`Verified ${raw.gate.outcome} at Robinhood block ${raw.evidence.block.number} (${args.includes("--offline") ? "offline evidence" : "onchain"})`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
