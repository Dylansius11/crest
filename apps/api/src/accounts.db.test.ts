import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase } from "@crest/db";
import { createRecordedAccountReader } from "./accounts.ts";

// Run only against a disposable, migrated database; never seed the user's local Supabase data.
const url = process.env.API_INTEGRATION_DATABASE_URL;
const suite = url ? describe : describe.skip;
const database = url ? createDatabase(url) : null;
const manifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));
const id = {
  loan: randomUUID(), collateral: randomUUID(), loanToken: randomUUID(), collateralToken: randomUUID(),
  morpho: randomUUID(), vault: randomUUID(), owner: randomUUID(), account: randomUUID(),
  policy: randomUUID(), snapshot: randomUUID(), position: randomUUID(), strategy: randomUUID(),
};
const bytes = (value: string) => Buffer.from(value.slice(2), "hex");
const fill = (digit: string, size: number) => Buffer.from(digit.repeat(size), "hex");
const accountAddress = `0x${randomUUID().replaceAll("-", "").padEnd(40, "a").slice(0, 40)}`;
const ownerAddress = `0x${randomUUID().replaceAll("-", "").padEnd(40, "b").slice(0, 40)}`;
const hashA = fill("a", 32);
const hashB = fill("b", 32);
const market = bytes(manifest.market.id);
const reader = database ? createRecordedAccountReader(database.db, manifest) : null;

beforeAll(async () => {
  if (!database) return;
  const { client } = database;
  await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled) values (4663, 'robinhood-mainnet', 'Robinhood Chain', 'ETH', 20, true) on conflict (chain_id) do nothing`;
  await client`insert into assets (id, canonical_symbol, kind, metadata_json) values (${id.loan}, 'USDG', 'stablecoin', '{}'::jsonb), (${id.collateral}, 'AAPL', 'stock_token', '{}'::jsonb)`;
  await client`insert into token_deployments (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.loanToken}, ${id.loan}, 4663, ${bytes(manifest.market.loanToken)}, 6, ${bytes(manifest.contracts.loanToken!.codeHash)}, 'https://example.com/loan', 1, ${hashA}, now(), 'verified'),
    (${id.collateralToken}, ${id.collateral}, 4663, ${bytes(manifest.market.collateralToken)}, 18, ${bytes(manifest.contracts.collateralToken!.codeHash)}, 'https://example.com/collateral', 1, ${hashA}, now(), 'verified')`;
  await client`insert into morpho_deployments (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.morpho}, 4663, ${bytes(manifest.contracts.morpho!.address)}, ${bytes(manifest.contracts.morpho!.codeHash)}, 'blue', 'https://example.com/morpho', 1, ${hashA}, now(), 'verified')`;
  await client`insert into morpho_markets (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
    values (${market}, ${id.morpho}, ${id.loanToken}, ${id.collateralToken}, ${bytes(manifest.market.oracle)}, ${bytes(manifest.market.irm)}, ${manifest.market.lltv}, true, 'verified', now())`;
  await client`insert into vault_deployments (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.vault}, 4663, ${bytes(manifest.vault.address)}, ${id.loanToken}, 18, 'fixed_adapter', ${bytes(manifest.vault.codeHash)}, 'none', '{}'::jsonb, 'https://example.com/vault', 1, ${hashA}, now(), 'verified')`;
  await client`insert into owners (id, address, first_seen_at, last_seen_at) values (${id.owner}, ${bytes(ownerAddress)}, now(), now())`;
  await client`insert into crest_accounts (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (${id.account}, 4663, ${bytes(accountAddress)}, ${id.owner}, ${fill("c", 32)}, 1, '1', ${fill("d", 32)}, 1, 'active')`;
  await client`insert into policies (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad, effective_block_number, effective_block_hash, activated_at)
    values (${id.policy}, ${id.account}, 1, 2, '{}'::jsonb, ${fill("e", 32)}, 'manual', 'active', ${market}, ${id.vault}, ${id.loanToken}, ${manifest.market.lltv}, 100, ${hashA}, now())`;
  await client`insert into account_snapshots (id, crest_account_id, owner_address, guardian_address, market_id, vault_deployment_id, max_collateral_assets, debt_ceiling_assets, max_strategy_assets, reserve_floor_assets, strategy_floor_assets, max_repay_per_action_assets, lower_ltv_wad, target_ltv_wad, upper_ltv_wad, critical_ltv_wad, borrowing_frozen, policy_nonce, loan_token_balance, block_number, block_hash, block_time, observed_at, provider_key)
    values (${id.snapshot}, ${id.account}, ${bytes(ownerAddress)}, ${fill("f", 20)}, ${market}, ${id.vault}, 10000000, 9000000, 8000000, 0, 0, 1000000, 200000000000000000, 400000000000000000, 500000000000000000, 600000000000000000, false, 1, 500000, 100, ${hashA}, now(), now(), 'api-test')`;
  await client`insert into position_snapshots (id, crest_account_id, market_id, borrow_shares, borrow_assets_up, collateral_assets, collateral_value, ltv_wad, morpho_health_wad, block_number, block_hash, block_time, observed_at, provider_key)
    values (${id.position}, ${id.account}, ${market}, 100, 1000000, 1000000000000000000, 2000000, 500000000000000000, 1250000000000000000, 100, ${hashA}, now(), now(), 'api-test')`;
  await client`insert into strategy_position_snapshots (id, crest_account_id, vault_deployment_id, share_balance, quoted_assets, max_withdrawable_assets, strategy_floor_assets, actionable_assets, block_number, block_hash, block_time, observed_at, provider_key)
    values (${id.strategy}, ${id.account}, ${id.vault}, 600000, 650000, 400000, 0, 400000, 100, ${hashB}, now(), now(), 'api-test')`;
});

afterAll(async () => { await database?.client.end(); });

suite("recorded account evidence over real PostgreSQL", () => {
  test("a skewed strategy snapshot never becomes a position", async () => {
    if (!reader) throw new Error("isolated database required");
    const position = await reader.positionByAddress(accountAddress);
    expect(position?.snapshot).toBeNull();
    expect(position?.assessment).toBeNull();
    expect(position?.realizedDebtRepaidAssets).toBeNull();
  });

  test("only a coherent canonical assessment and repayment events become position evidence", async () => {
    if (!database || !reader) throw new Error("isolated database required");
    const { client } = database;
    await client`update strategy_position_snapshots set block_hash = ${hashA} where id = ${id.strategy}`;
    const rates = {
      borrow: { status: "normal", reasons: [], value: { kind: "market_borrow", value: { $bigint: "52000000000000000" }, scale: { $bigint: "1000000000000000000" }, convention: "apy", window: "P1D" },
        provenance: { kind: "http", url: "https://api.morpho.org/borrow", fetchedAt: "2026-10-02T05:45:37.700Z" } },
      vault: { status: "unknown", reasons: ["unreadable"], value: null, provenance: { kind: "http", url: "https://api.morpho.org/vault", fetchedAt: "2026-10-02T05:45:37.702Z" } },
    };
    await client`insert into risk_assessments (id, crest_account_id, policy_id, account_snapshot_id, position_snapshot_id, strategy_position_snapshot_id, risk_engine_version, status, owner_borrow_capacity_assets, repay_capacity_assets, estimated_annual_carry_assets, estimated_spread_bps, recommended_action, input_json, canonical_input_hash, created_at)
      values (${randomUUID()}, ${id.account}, ${id.policy}, ${id.snapshot}, ${id.position}, ${id.strategy}, 'crest-risk/1', 'NORMAL', 100000, 0, -120000, -12, 'none', ${JSON.stringify({ rates })}::jsonb, ${fill("1", 32)}, now())`;
    for (const [index, amount, canonical] of [[0, 80, true], [1, 20, true], [2, 900, false]] as const) {
      await client`insert into realized_strategy_events (crest_account_id, kind, transaction_hash, log_index, assets_before, assets_after, debt_before_assets, debt_after_assets, debt_repaid_assets, block_number, block_hash, block_time, canonical, observed_at)
        values (${id.account}, 'repay', ${fill(String(index + 2), 32)}, ${index}, 2000, 1000, ${amount + 1}, 1, ${amount}, 100, ${hashA}, now(), ${canonical}, now())`;
    }
    const result = await reader.positionByAddress(accountAddress);
    expect(result?.snapshot).toMatchObject({
      blockNumber: "100", debtAssets: "1000000", collateralValueAssets: "2000000", ltvWad: "500000000000000000",
      morphoHealthWad: "1250000000000000000", lowerLtvWad: "200000000000000000",
      targetLtvWad: "400000000000000000", upperLtvWad: "500000000000000000", criticalLtvWad: "600000000000000000",
      quotedVaultAssets: "650000", withdrawableVaultAssets: "400000",
    });
    expect(result?.snapshot).toMatchObject({ reserveFloorAssets: "0", strategyFloorAssets: "0", maxRepayPerActionAssets: "1000000" });
    expect(result?.assessment).toMatchObject({ status: "NORMAL", recommendedAction: "none", projectedCarryAssets: "-120000", projectedSpreadBps: "-12" });
    expect(result?.assessment?.rates.borrow).toEqual({ status: "normal", reasons: [], value: "52000000000000000", scale: "1000000000000000000",
      convention: "apy", window: "P1D", source: "https://api.morpho.org/borrow", observedAt: "2026-10-02T05:45:37.700Z" });
    expect(result?.assessment?.rates.vault).toMatchObject({ status: "unknown", reasons: ["unreadable"], value: null, source: "https://api.morpho.org/vault" });
    expect(result?.realizedDebtRepaidAssets).toBe("100");
    // The latest canonical repayment wins; the later non-canonical row never does.
    expect(result?.latestRepayment).toEqual({ debtBeforeAssets: "21", debtAfterAssets: "1", debtRepaidAssets: "20", blockNumber: "100", transactionHash: `0x${"33".repeat(16)}` });
    await client`update account_snapshots set canonical = false where id = ${id.snapshot}`;
    const invalidated = await reader.positionByAddress(accountAddress);
    expect(invalidated?.snapshot).toBeNull();
    expect(invalidated?.assessment).toBeNull();
    expect(invalidated?.realizedDebtRepaidAssets).toBe("100");
  });
});
