import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDatabase } from "./client.ts";
import { persistAssessment } from "./assessments.ts";

const { client, db } = createDatabase(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
const salt = Buffer.from(randomUUID().replaceAll("-", "").slice(0, 8), "hex");
const bytes = (hex: string, count: number) => {
  const result = Buffer.from(hex.repeat(count), "hex");
  salt.copy(result, 0, 0, Math.min(salt.length, result.length));
  return result;
};
const id = {
  loan: randomUUID(), collateral: randomUUID(), loanToken: randomUUID(), collateralToken: randomUUID(),
  morpho: randomUUID(), vault: randomUUID(), owner: randomUUID(), account: randomUUID(), policy: randomUUID(),
};
const marketId = bytes("31", 32);
const address = bytes("3a", 20);
const hash = bytes("ab", 32);

beforeAll(async () => {
  await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
    values (4663, 'robinhood-mainnet', 'Robinhood Chain', 'ETH', 20, true) on conflict (chain_id) do nothing`;
  await client`insert into assets (id, canonical_symbol, kind, metadata_json) values
    (${id.loan}, 'USDG', 'stablecoin', '{}'::jsonb),
    (${id.collateral}, 'AAPL', 'stock_token', '{}'::jsonb)`;
  await client`insert into token_deployments
    (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.loanToken}, ${id.loan}, 4663, ${bytes("3b", 20)}, 6, ${bytes("31", 32)}, 'https://example.com/loan', 1, ${hash}, now(), 'verified'),
    (${id.collateralToken}, ${id.collateral}, 4663, ${bytes("3c", 20)}, 18, ${bytes("32", 32)}, 'https://example.com/collateral', 1, ${hash}, now(), 'verified')`;
  await client`insert into morpho_deployments
    (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.morpho}, 4663, ${bytes("3d", 20)}, ${bytes("33", 32)}, 'blue', 'https://example.com/morpho', 1, ${hash}, now(), 'verified')`;
  await client`insert into morpho_markets
    (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
    values (${marketId}, ${id.morpho}, ${id.loanToken}, ${id.collateralToken}, ${bytes("3e", 20)}, ${bytes("3f", 20)}, 625000000000000000, true, 'verified', now())`;
  await client`insert into vault_deployments
    (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.vault}, 4663, ${bytes("42", 20)}, ${id.loanToken}, 18, 'fixed_adapter', ${bytes("34", 32)}, 'none', '{}'::jsonb, 'https://example.com/vault', 1, ${hash}, now(), 'verified')`;
  await client`insert into owners (id, address, first_seen_at, last_seen_at) values (${id.owner}, ${bytes("43", 20)}, now(), now())`;
  await client`insert into crest_accounts
    (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (${id.account}, 4663, ${address}, ${id.owner}, ${bytes("05", 32)}, 1, '1', ${bytes("06", 32)}, 1, 'active')`;
  await client`insert into policies
    (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad, effective_block_number, effective_block_hash, activated_at)
    values (${id.policy}, ${id.account}, 1, 2, '{}'::jsonb, ${bytes("07", 32)}, 'manual', 'active', ${marketId}, ${id.vault}, ${id.loanToken}, 625000000000000000, 1, ${hash}, now())`;
});
afterAll(async () => { await client.end(); });

const assessment = (suffix: string) => ({
  id: `0x${salt.toString("hex")}${suffix.repeat(28)}`,
  crestAccountId: id.account, policyId: id.policy, riskEngineVersion: "crest-risk/1",
  status: "DEGRADED", ltvWad: null, morphoHealthWad: null, policyHealthWad: null,
  ownerBorrowCapacityAssets: 0n, repayCapacityAssets: 0n,
  estimatedAnnualCarryAssets: null, estimatedSpreadBps: null,
  recommendedAction: "owner_review", reasonCodes: ["stale"], canonicalInputHash: bytes(suffix, 32),
  inputJson: { account: { policyNonce: { $bigint: "1" } }, head: { block: "pinned" } },
  createdAt: new Date(),
});

describe("persisted monitor evaluation", () => {
  test("replaying the same assessment creates exactly one trigger without overwriting evidence", async () => {
    const record = assessment("21");
    const trigger = { id: `0x${salt.toString("hex")}${"22".repeat(28)}`, idempotencyKey: bytes("22", 32), actionKind: "freeze", requestedAssets: null, reasonCodes: ["stale"] };
    await persistAssessment(db, record, trigger);
    await expect(persistAssessment(db, { ...record, inputJson: { altered: true } }, trigger)).rejects.toThrow("assessment evidence changed");
    const rows = await client`select input_json from risk_assessments where id = ${record.id}`;
    const triggers = await client`select id, status from automation_triggers where assessment_id = ${record.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.input_json).toEqual(record.inputJson);
    expect(triggers).toEqual([{ id: trigger.id, status: "detected" }]);
  });

  test("an assessment records its pinned market observation once even on replay", async () => {
    const [snapshot] = await client`insert into market_snapshots
      (market_id, total_supply_assets, total_supply_shares, total_borrow_assets, total_borrow_shares,
       available_loan_assets, borrow_rate_value, borrow_rate_scale, oracle_value, oracle_scale,
       oracle_status, sequencer_status, route_status, block_number, block_hash, block_time, observed_at, provider_key)
      values (${marketId}, 100, 100, 20, 20, 80, 0, 1, null, 1, 'unknown', 'normal', 'normal',
              1, ${hash}, now(), now(), 'test-rpc') returning id`;
    const record = { ...assessment("24"), marketSnapshotId: snapshot!.id as string };
    await persistAssessment(db, record, null);
    await persistAssessment(db, record, null);
    const links = await client`select input_kind, observation_id from assessment_inputs where assessment_id = ${record.id}`;
    expect(links).toEqual([{ input_kind: "market", observation_id: snapshot!.id }]);
  });

  test("signed projected carry and owner recommendation never create a realized repayment or Guardian trigger", async () => {
    const record = { ...assessment("23"), status: "UPSIZE_AVAILABLE", recommendedAction: "owner_borrow", estimatedAnnualCarryAssets: -12_000_000n, estimatedSpreadBps: -21n, reasonCodes: [], ownerBorrowCapacityAssets: 1n };
    await persistAssessment(db, record, null);
    const rows = await client`select estimated_annual_carry_assets, estimated_spread_bps, recommended_action from risk_assessments where id = ${record.id}`;
    const triggers = await client`select id from automation_triggers where assessment_id = ${record.id}`;
    const realized = await client`select id from realized_strategy_events where crest_account_id = ${id.account}`;
    expect(rows).toEqual([{ estimated_annual_carry_assets: "-12000000", estimated_spread_bps: "-21", recommended_action: "owner_borrow" }]);
    expect(triggers).toEqual([]);
    expect(realized).toEqual([]);
  });
});
