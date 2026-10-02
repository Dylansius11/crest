import { sql, type SQL } from "drizzle-orm";

import { validateDeploymentManifest } from "@crest/contracts/manifest";
import type { ContractEvidence, DeploymentManifest } from "@crest/contracts/manifest";

/**
 * Route registration: record the active manifest's network, tokens, Morpho deployment, market, and vault as the
 * registry rows that enrollment, the monitor, and Custos join against.
 *
 * Registration is idempotent and append-only. A row that already exists must match the manifest exactly; a
 * differing code hash, decimals, oracle, IRM, LLTV, or token binding is refused rather than overwritten, so a
 * changed route can only tighten behavior until an operator resolves it.
 */

/** Operational depth the monitor pins below head and Custos waits before reconciling (~2 s at ~85 ms blocks). */
export const ROUTE_CONFIRMATION_DEPTH = 20;
/** Morpho Vault V2 shares carry max(18, asset decimals) decimals; both registered routes read 18 onchain. */
const VAULT_V2_SHARE_DECIMALS = 18;
const NETWORK_SLUG: Record<DeploymentManifest["network"]["chainId"], string> = {
  4663: "robinhood-mainnet",
  46630: "robinhood-testnet",
};

export interface RouteRegistryDatabase {
  transaction<T>(run: (tx: { execute(query: SQL): Promise<unknown> }) => Promise<T>): Promise<T>;
}

export interface RegisteredRoute {
  chainId: number;
  trust: DeploymentManifest["trust"]["level"];
  marketId: string;
  vault: string;
  /** Rows this call inserted; zero on a repeated registration of the same manifest. */
  inserted: number;
}

export class RouteRegistryConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteRegistryConflict";
  }
}

interface RouteRows {
  status: string;
  /** Postgres `text[]` literal; drizzle's `sql` would expand a JS array into a parameter list. */
  reasonCodes: string;
  verifiedBlockNumber: string;
  verifiedBlockHash: Buffer;
  verifiedAt: string;
}

const bytes = (hex: string) => Buffer.from(hex.slice(2), "hex");
const hex = (value: Buffer | Uint8Array) => `0x${Buffer.from(value).toString("hex")}`;

function contract(manifest: DeploymentManifest, key: string): ContractEvidence & { source: string } {
  const evidence = manifest.contracts[key];
  if (evidence === undefined) throw new RouteRegistryConflict(`manifest has no ${key} contract evidence`);
  if (!("source" in evidence) || typeof evidence.source !== "string") {
    throw new RouteRegistryConflict(`manifest ${key} evidence has no source URL`);
  }
  return { ...evidence, source: evidence.source };
}

interface RouteToken extends ContractEvidence {
  source: string;
  decimals: number;
  symbol: string;
}

function token(manifest: DeploymentManifest, key: "loanToken" | "collateralToken"): RouteToken {
  const evidence = contract(manifest, key);
  if (evidence.decimals === undefined) throw new RouteRegistryConflict(`manifest ${key} evidence has no decimals`);
  if (!("symbol" in evidence) || typeof evidence.symbol !== "string" || evidence.symbol.length === 0) {
    throw new RouteRegistryConflict(`manifest ${key} evidence has no symbol`);
  }
  return { ...evidence, decimals: evidence.decimals, symbol: evidence.symbol };
}

async function rows<T>(tx: { execute(query: SQL): Promise<unknown> }, query: SQL): Promise<T[]> {
  const result = (await tx.execute(query)) as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : result.rows ?? [];
}

function requireSame(subject: string, expected: Record<string, string>, actual: Record<string, string> | undefined) {
  if (actual === undefined) throw new RouteRegistryConflict(`${subject} row could not be read back`);
  const drift = Object.keys(expected).filter((key) => expected[key]?.toLowerCase() !== actual[key]?.toLowerCase());
  if (drift.length > 0) {
    throw new RouteRegistryConflict(`${subject} is already registered with different ${drift.join(", ")}; resolve it before registering this manifest`);
  }
}

/** Registers the manifest route in one transaction and proves every resulting row matches the manifest. */
export async function registerManifestRoute(db: RouteRegistryDatabase, manifest: DeploymentManifest): Promise<RegisteredRoute> {
  const errors = validateDeploymentManifest(manifest);
  if (errors.length > 0) throw new RouteRegistryConflict(`deployment manifest is invalid: ${errors.join("; ")}`);
  if (manifest.gate.outcome !== "full_route") {
    throw new RouteRegistryConflict(`deployment manifest gate is ${manifest.gate.outcome}; only a full_route manifest is registered`);
  }
  if (manifest.vault.generation !== "Morpho Vault V2") {
    throw new RouteRegistryConflict(`vault generation ${manifest.vault.generation} has no registered share-decimal rule`);
  }

  const chainId = manifest.network.chainId;
  const morpho = contract(manifest, "morpho");
  const vault = contract(manifest, "vault");
  const loan = token(manifest, "loanToken");
  const collateral = token(manifest, "collateralToken");
  const sandbox = manifest.trust.level === "sandbox";
  const evidence: RouteRows = {
    // A sandbox route is never recorded as verified; consumers see the tier on every route row.
    status: sandbox ? "degraded" : "verified",
    reasonCodes: sandbox ? "{sandbox_route}" : "{}",
    verifiedBlockNumber: manifest.evidence.block.number,
    verifiedBlockHash: bytes(manifest.evidence.block.hash),
    verifiedAt: manifest.evidence.retrievedAt,
  };

  return db.transaction(async (tx) => {
    let inserted = 0;
    const count = (result: unknown[]) => { inserted += result.length; };

    count(await rows(tx, sql`
      insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
      values (${chainId}, ${NETWORK_SLUG[chainId]}, ${manifest.network.name}, 'ETH', ${ROUTE_CONFIRMATION_DEPTH}, true)
      on conflict (chain_id) do nothing returning chain_id`));

    const tokenId = async (entry: RouteToken, kind: "stablecoin" | "stock_token") => {
      const existing = await rows<{ id: string; decimals: number; codeHash: Buffer }>(tx, sql`
        select id, decimals, code_hash as "codeHash" from token_deployments
        where chain_id = ${chainId} and address = ${bytes(entry.address)}`);
      const prior = existing[0];
      if (prior !== undefined) {
        requireSame(`token ${entry.address}`, { decimals: String(entry.decimals), codeHash: entry.codeHash },
          { decimals: String(prior.decimals), codeHash: hex(prior.codeHash) });
        return prior.id;
      }
      const [asset] = await rows<{ id: string }>(tx, sql`
        insert into assets (canonical_symbol, kind, metadata_json)
        values (${entry.symbol}, ${kind}, ${JSON.stringify({ trust: manifest.trust.level, chainId })}::jsonb)
        returning id`);
      if (asset === undefined) throw new RouteRegistryConflict(`asset ${entry.symbol} did not persist`);
      const created = await rows<{ id: string }>(tx, sql`
        insert into token_deployments
          (asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
        values (${asset.id}, ${chainId}, ${bytes(entry.address)}, ${entry.decimals}, ${bytes(entry.codeHash)}, ${entry.source},
          ${evidence.verifiedBlockNumber}, ${evidence.verifiedBlockHash}, ${evidence.verifiedAt}, ${evidence.status})
        returning id`);
      count([asset, ...created]);
      const [row] = created;
      if (row === undefined) throw new RouteRegistryConflict(`token ${entry.address} did not persist`);
      return row.id;
    };
    const loanTokenId = await tokenId(loan, "stablecoin");
    const collateralTokenId = await tokenId(collateral, "stock_token");

    count(await rows(tx, sql`
      insert into morpho_deployments (chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values (${chainId}, ${bytes(morpho.address)}, ${bytes(morpho.codeHash)}, 'blue', ${morpho.source},
        ${evidence.verifiedBlockNumber}, ${evidence.verifiedBlockHash}, ${evidence.verifiedAt}, ${evidence.status})
      on conflict (chain_id, address) do nothing returning id`));
    const [morphoRow] = await rows<{ id: string; codeHash: Buffer }>(tx, sql`
      select id, code_hash as "codeHash" from morpho_deployments where chain_id = ${chainId} and address = ${bytes(morpho.address)}`);
    requireSame(`Morpho ${morpho.address}`, { codeHash: morpho.codeHash }, morphoRow && { codeHash: hex(morphoRow.codeHash) });
    if (morphoRow === undefined) throw new RouteRegistryConflict("Morpho row could not be read back");

    count(await rows(tx, sql`
      insert into morpho_markets
        (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad,
         params_hash_verified, status, status_reason_codes, verified_at)
      values (${bytes(manifest.market.id)}, ${morphoRow.id}, ${loanTokenId}, ${collateralTokenId}, ${bytes(manifest.market.oracle)},
        ${bytes(manifest.market.irm)}, ${manifest.market.lltv}, ${manifest.market.id.toLowerCase() === manifest.market.derivedId.toLowerCase()},
        ${evidence.status}, ${evidence.reasonCodes}::text[], ${evidence.verifiedAt})
      on conflict (id) do nothing returning id`));
    const [market] = await rows<{ morpho: string; loan: string; collateral: string; oracle: Buffer; irm: Buffer; lltv: string }>(tx, sql`
      select morpho_deployment_id as morpho, loan_token_id as loan, collateral_token_id as collateral,
        oracle_address as oracle, irm_address as irm, lltv_wad::text as lltv
      from morpho_markets where id = ${bytes(manifest.market.id)}`);
    requireSame(`market ${manifest.market.id}`,
      { morpho: morphoRow.id, loan: loanTokenId, collateral: collateralTokenId, oracle: manifest.market.oracle, irm: manifest.market.irm, lltv: manifest.market.lltv },
      market && { morpho: market.morpho, loan: market.loan, collateral: market.collateral, oracle: hex(market.oracle), irm: hex(market.irm), lltv: market.lltv });

    const manager = {
      owner: "owner" in manifest.vault.governance ? manifest.vault.governance.owner : null,
      curator: "curator" in manifest.vault.governance ? manifest.vault.governance.curator : null,
      liquidityAdapter: manifest.vault.governance.liquidityAdapter,
    };
    count(await rows(tx, sql`
      insert into vault_deployments
        (chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json,
         reason_codes, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values (${chainId}, ${bytes(manifest.vault.address)}, ${loanTokenId}, ${VAULT_V2_SHARE_DECIMALS}, 'erc4626', ${bytes(manifest.vault.codeHash)},
        'none', ${JSON.stringify(manager)}::jsonb, ${evidence.reasonCodes}::text[], ${vault.source},
        ${evidence.verifiedBlockNumber}, ${evidence.verifiedBlockHash}, ${evidence.verifiedAt}, ${evidence.status})
      on conflict (chain_id, address) do nothing returning id`));
    const [vaultRow] = await rows<{ asset: string; codeHash: Buffer }>(tx, sql`
      select asset_token_id as asset, code_hash as "codeHash" from vault_deployments
      where chain_id = ${chainId} and address = ${bytes(manifest.vault.address)}`);
    requireSame(`vault ${manifest.vault.address}`, { asset: loanTokenId, codeHash: manifest.vault.codeHash },
      vaultRow && { asset: vaultRow.asset, codeHash: hex(vaultRow.codeHash) });

    return { chainId, trust: manifest.trust.level, marketId: manifest.market.id, vault: manifest.vault.address, inserted };
  });
}
