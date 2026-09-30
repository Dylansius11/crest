import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { getAddress } from "viem";
import type { Address } from "viem";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { computeManifestIntegrity } from "@crest/contracts/manifest";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase } from "@crest/db";
import { marketIdOf } from "@crest/morpho";
import { compilePolicy, routeContextOf } from "@crest/policy";

import { loadMonitoredPolicy } from "./registry.ts";

const { client, db } = createDatabase(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
const baseManifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));
const [morpho, loan, collateral, oracle, irm, vault] = Array.from(
  { length: 6 },
  () => getAddress(`0x${randomBytes(20).toString("hex")}`),
) as [Address, Address, Address, Address, Address, Address];
const marketId = marketIdOf({ loanToken: loan, collateralToken: collateral, oracle, irm, lltv: BigInt(baseManifest.market.lltv) });
const manifestWithoutIntegrity = {
  ...baseManifest,
  contracts: {
    ...baseManifest.contracts,
    morpho: { ...baseManifest.contracts.morpho!, address: morpho },
    loanToken: { ...baseManifest.contracts.loanToken!, address: loan },
    collateralToken: { ...baseManifest.contracts.collateralToken!, address: collateral },
    oracle: { ...baseManifest.contracts.oracle!, address: oracle },
    irm: { ...baseManifest.contracts.irm!, address: irm },
    vault: { ...baseManifest.contracts.vault!, address: vault },
  },
  market: {
    ...baseManifest.market,
    id: marketId,
    derivedId: marketId,
    loanToken: loan,
    collateralToken: collateral,
    oracle,
    irm,
  },
  vault: { ...baseManifest.vault, address: vault, asset: loan },
};
const manifest = {
  ...manifestWithoutIntegrity,
  integrity: { algorithm: "sha256", digest: computeManifestIntegrity(manifestWithoutIntegrity) },
};
const account = getAddress(`0x${randomBytes(20).toString("hex")}`);
const owner = getAddress(`0x${randomBytes(20).toString("hex")}`);
const guardian = getAddress(`0x${randomBytes(20).toString("hex")}`);
const route = routeContextOf(manifest, { account, owner });
const draft = {
  schemaVersion: 2,
  intents: [
    { asset: route.market.collateralToken, intent: { kind: "PROTECT_AND_BORROW", marketId: route.marketId } },
    { asset: route.market.loanToken, intent: { kind: "EARN_STABLE", vaultId: `${route.chainId}:${route.vault}` } },
  ],
  maxCollateralAssets: "10000000000000000000",
  debtCeilingAssets: "1500000000",
  maxStrategyAssets: "1500000000",
  reserveFloorAssets: "50000000",
  strategyFloorAssets: "0",
  maxRepayPerActionAssets: "500000000",
  lowerLtvWad: "300000000000000000",
  targetLtvWad: "350000000000000000",
  upperLtvWad: "420000000000000000",
  criticalLtvWad: "500000000000000000",
  minimumNetSpreadBps: "100",
  maxOracleDivergenceBps: "100",
  harvestThresholdAssets: "10000000",
  triggers: { freezeOnOracleDegraded: true, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true },
  guardian,
};
const compilation = compilePolicy(draft, route);
if (!compilation.ok) throw new Error(compilation.issues.join("; "));
const compiled = compilation.policy;

const id = {
  loanAsset: randomUUID(), collateralAsset: randomUUID(), loanToken: randomUUID(), collateralToken: randomUUID(),
  morpho: randomUUID(), vault: randomUUID(), owner: randomUUID(), account: randomUUID(), policy: randomUUID(),
};
const blockHash = Buffer.from("ab".repeat(32), "hex");
const deploymentBlock = 100n;
const activationBlock = 110n;
const bytes = (hex: string) => Buffer.from(hex.slice(2), "hex");

describe("monitored policy registry", () => {
  beforeAll(async () => {
    await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
      values (${manifest.network.chainId}, ${`registry-${randomUUID()}`}, 'Registry test', 'ETH', 20, true)
      on conflict (chain_id) do update set confirmation_depth = excluded.confirmation_depth, enabled = excluded.enabled`;
    await client`insert into assets (id, canonical_symbol, kind, metadata_json) values
      (${id.loanAsset}, 'REGISTRY_LOAN', 'stablecoin', '{}'::jsonb),
      (${id.collateralAsset}, 'REGISTRY_COLLATERAL', 'stock_token', '{}'::jsonb)`;
    await client`insert into token_deployments
      (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values
      (${id.loanToken}, ${id.loanAsset}, ${manifest.network.chainId}, ${bytes(route.market.loanToken)}, ${route.tokens.loanDecimals}, ${bytes(manifest.contracts.loanToken!.codeHash)}, 'https://example.com/loan', 1, ${blockHash}, now(), 'verified'),
      (${id.collateralToken}, ${id.collateralAsset}, ${manifest.network.chainId}, ${bytes(route.market.collateralToken)}, ${route.tokens.collateralDecimals}, ${bytes(manifest.contracts.collateralToken!.codeHash)}, 'https://example.com/collateral', 1, ${blockHash}, now(), 'verified')`;
    await client`insert into morpho_deployments
      (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values (${id.morpho}, ${manifest.network.chainId}, ${bytes(route.morpho)}, ${bytes(manifest.contracts.morpho!.codeHash)}, 'blue', 'https://example.com/morpho', 1, ${blockHash}, now(), 'verified')`;
    await client`insert into morpho_markets
      (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
      values (${bytes(route.marketId)}, ${id.morpho}, ${id.loanToken}, ${id.collateralToken}, ${bytes(route.market.oracle)}, ${bytes(route.market.irm)}, ${route.market.lltv.toString()}, true, 'verified', now())`;
    await client`insert into vault_deployments
      (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values (${id.vault}, ${manifest.network.chainId}, ${bytes(route.vault)}, ${id.loanToken}, 18, 'fixed_adapter', ${bytes(manifest.vault.codeHash)}, 'none', '{}'::jsonb, 'https://example.com/vault', 1, ${blockHash}, now(), 'verified')`;
    await client`insert into owners (id, address, first_seen_at, last_seen_at) values (${id.owner}, ${bytes(owner)}, now(), now())`;
    await client`insert into crest_accounts
      (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
      values (${id.account}, ${manifest.network.chainId}, ${bytes(account)}, ${id.owner}, ${blockHash}, ${deploymentBlock.toString()}, '1', ${blockHash}, 1, 'active')`;
    await client`insert into policies
      (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, policy_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad)
      values (${id.policy}, ${id.account}, 1, 2, ${JSON.stringify(draft)}::jsonb, ${bytes(compiled.contentHash)}, ${bytes(compiled.policyHash)}, 'manual', 'pending', ${bytes(route.marketId)}, ${id.vault}, ${id.loanToken}, ${route.market.lltv.toString()})`;
  });

  afterAll(async () => {
    await client`delete from canonical_account_events where crest_account_id = ${id.account}`;
    await client`delete from policies where id = ${id.policy}`;
    await client`delete from crest_accounts where id = ${id.account}`;
    await client`delete from owners where id = ${id.owner}`;
    await client`delete from vault_deployments where id = ${id.vault}`;
    await client`delete from morpho_markets where id = ${bytes(route.marketId)}`;
    await client`delete from morpho_deployments where id = ${id.morpho}`;
    await client`delete from token_deployments where id in (${id.loanToken}, ${id.collateralToken})`;
    await client`delete from assets where id in (${id.loanAsset}, ${id.collateralAsset})`;
    await client.end();
  });

  test("requires the one canonical PolicyConfigured activation and exact compiled route identity", async () => {
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();

    await client`update policies
      set status = 'active', effective_block_number = ${activationBlock.toString()}, effective_block_hash = ${blockHash}, activated_at = now()
      where id = ${id.policy}`;
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();

    await client`insert into canonical_account_events
      (crest_account_id, event_kind, transaction_hash, log_index, block_number, block_hash, block_time, canonical, reorged_at, payload_json, observed_at)
      values (${id.account}, 'PolicyConfigured', ${Buffer.from("cd".repeat(32), "hex")}, 0, ${activationBlock.toString()}, ${blockHash}, now(), true, null,
        ${JSON.stringify({ policyNonce: "1", policyHash: compiled.policyHash, marketId: route.marketId, yieldVault: route.vault })}::jsonb, now())`;

    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).resolves.toMatchObject({
      accountId: id.account, policyId: id.policy, vaultDeploymentId: id.vault, compiled, nonce: 1n, deploymentBlock, confirmationDepth: 20,
    });
    await client`update canonical_account_events
      set canonical = false, reorged_at = now()
      where crest_account_id = ${id.account} and event_kind = 'PolicyConfigured'`;
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();
    await client`update canonical_account_events
      set canonical = true, reorged_at = null
      where crest_account_id = ${id.account} and event_kind = 'PolicyConfigured'`;


    await client`update morpho_markets set oracle_address = ${Buffer.from("de".repeat(20), "hex")} where id = ${bytes(route.marketId)}`;
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();
    await client`update morpho_markets set oracle_address = ${bytes(route.market.oracle)} where id = ${bytes(route.marketId)}`;
    await client`update morpho_deployments set code_hash = ${Buffer.from("ad".repeat(32), "hex")} where id = ${id.morpho}`;
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();
    await client`update morpho_deployments set code_hash = ${bytes(manifest.contracts.morpho!.codeHash)} where id = ${id.morpho}`;


    await client`update policies set content_hash = ${Buffer.from("ef".repeat(32), "hex")} where id = ${id.policy}`;
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();
    await client`update policies set content_hash = ${bytes(compiled.contentHash)} where id = ${id.policy}`;
    await client`update policies set policy_hash = ${Buffer.from("fe".repeat(32), "hex")} where id = ${id.policy}`;
    await expect(loadMonitoredPolicy(db, manifest, account, 120n)).rejects.toThrow();
  });
});
