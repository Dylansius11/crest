import { createHash } from "node:crypto";

/**
 * The reviewed deployment manifest: the one description of the verified Crest route.
 *
 * This module is pure and offline. Onchain drift checks live in `scripts/verify-deployment-manifest.ts`,
 * which re-exports these rules so the CLI, the services, and the web app judge a manifest identically.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^(0|[1-9][0-9]*)$/;
/**
 * Every supported chain has exactly one trust tier. Mainnet routes are reviewed against official issuer, oracle,
 * and Morpho sources; the testnet publishes none, so a 46630 route can only ever be a labeled SANDBOX.
 */
export const ROUTE_TRUST_BY_CHAIN = { 4663: "reviewed", 46630: "sandbox" } as const;
export type SupportedChainId = keyof typeof ROUTE_TRUST_BY_CHAIN;
export type RouteTrustLevel = (typeof ROUTE_TRUST_BY_CHAIN)[SupportedChainId];
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface ContractEvidence {
  address: string;
  codeHash: string;
  decimals?: number;
}

export interface DeploymentManifest {
  schemaVersion: number;
  network: { chainId: SupportedChainId; name: string; rpcUrl: string; explorerUrl: string };
  /** Route trust tier; `disclosures` name every reason a sandbox route is not a reviewed route. */
  trust: { level: RouteTrustLevel; disclosures: string[] };
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
    governance: { liquidityAdapter: string };
    /** Share price at the evidence block, RAY-scaled across share and asset decimals: the vault-loss baseline. */
    state: { sharePriceRay: string };
    /**
     * With a liquidity adapter, exactly one entry has `liquidityRole: "default"`: the market it exits through.
     * An idle-only vault (zero liquidity adapter) has none: normal exits draw on idle assets alone.
     */
    downstreamAllocations: Array<{ adapter: string; marketId: string; liquidityRole: "default" | "allocated" }>;
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

/** Canonical object guard for this package; fields stay `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
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
  const chainId = at(value, "network", "chainId");
  const expectedTrust = typeof chainId === "number" && Object.hasOwn(ROUTE_TRUST_BY_CHAIN, chainId)
    ? ROUTE_TRUST_BY_CHAIN[chainId as SupportedChainId]
    : undefined;
  if (expectedTrust === undefined) errors.push("network.chainId must be 4663 or 46630");
  else if (at(value, "trust", "level") !== expectedTrust) errors.push(`trust.level must be ${expectedTrust} on chain ${String(chainId)}`);
  const disclosures = at(value, "trust", "disclosures");
  if (!Array.isArray(disclosures) || disclosures.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    errors.push("trust.disclosures must be an array of non-empty strings");
  } else if (expectedTrust === "sandbox" && disclosures.length === 0) {
    errors.push("a sandbox route must disclose why it is not reviewed");
  }
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
  requirePattern(errors, at(value, "vault", "governance", "liquidityAdapter"), ADDRESS, "vault.governance.liquidityAdapter");
  requirePattern(errors, at(value, "vault", "state", "sharePriceRay"), UINT, "vault.state.sharePriceRay");
  const allocations = at(value, "vault", "downstreamAllocations");
  const defaults = Array.isArray(allocations) ? allocations.filter((entry: unknown) => at(entry, "liquidityRole") === "default") : [];
  const liquidityAdapter = at(value, "vault", "governance", "liquidityAdapter");
  if (sameAddress(liquidityAdapter, ZERO_ADDRESS)) {
    if (defaults.length !== 0) errors.push("an idle-only vault has no default liquidity market");
  } else {
    const [liquidityMarket] = defaults;
    if (
      defaults.length !== 1
      || !sameAddress(at(liquidityMarket, "adapter"), liquidityAdapter)
      || !HASH.test(String(at(liquidityMarket, "marketId")))
    ) {
      errors.push("vault must name exactly one default liquidity market on its liquidity adapter");
    }
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
