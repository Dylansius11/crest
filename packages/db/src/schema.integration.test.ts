import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { marketPolicies, policies, rateObservations } from "./schema.ts";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { client, db } = createDatabase(databaseUrl);

const bytes = (digit: string, length: number) => Buffer.from(digit.repeat(length), "hex");
const ids = {
  loanAsset: randomUUID(),
  collateralAsset: randomUUID(),
  loanToken: randomUUID(),
  collateralToken: randomUUID(),
  morpho: randomUUID(),
  vault: randomUUID(),
  wrongVault: randomUUID(),
  owner: randomUUID(),
  account: randomUUID(),
  policy: randomUUID(),
  assessment: randomUUID(),
  trigger: randomUUID(),
};
const marketId = bytes("11", 32);
const accountAddress = bytes("aa", 20);

beforeAll(async () => {
  await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
    values (4663, 'robinhood-mainnet', 'Robinhood Chain', 'ETH', 20, true)
    on conflict (chain_id) do nothing`;
  await client`insert into assets (id, canonical_symbol, kind, metadata_json)
    values (${ids.loanAsset}, 'USDG', 'stablecoin', '{}'::jsonb),
           (${ids.collateralAsset}, 'AAPL', 'stock_token', '{}'::jsonb)`;
  await client`insert into token_deployments
    (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values
    (${ids.loanToken}, ${ids.loanAsset}, 4663, ${bytes("bb", 20)}, 6, ${bytes("01", 32)}, 'https://example.com/loan', 62692076, ${bytes("02", 32)}, now(), 'verified'),
    (${ids.collateralToken}, ${ids.collateralAsset}, 4663, ${bytes("cc", 20)}, 18, ${bytes("03", 32)}, 'https://example.com/collateral', 62692076, ${bytes("02", 32)}, now(), 'verified')`;
  await client`insert into morpho_deployments
    (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${ids.morpho}, 4663, ${bytes("dd", 20)}, ${bytes("04", 32)}, 'blue', 'https://example.com/morpho', 62692076, ${bytes("02", 32)}, now(), 'verified')`;
  await client`insert into morpho_markets
    (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
    values (${marketId}, ${ids.morpho}, ${ids.loanToken}, ${ids.collateralToken}, ${bytes("ee", 20)}, ${bytes("ff", 20)}, 625000000000000000, true, 'verified', now())`;
  await client`insert into vault_deployments
    (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values
    (${ids.vault}, 4663, ${bytes("12", 20)}, ${ids.loanToken}, 18, 'fixed_adapter', ${bytes("05", 32)}, 'none', '{}'::jsonb, 'https://example.com/vault', 62692076, ${bytes("02", 32)}, now(), 'verified'),
    (${ids.wrongVault}, 4663, ${bytes("13", 20)}, ${ids.collateralToken}, 18, 'fixed_adapter', ${bytes("06", 32)}, 'none', '{}'::jsonb, 'https://example.com/wrong-vault', 62692076, ${bytes("02", 32)}, now(), 'verified')`;
  await client`insert into owners (id, address, first_seen_at, last_seen_at)
    values (${ids.owner}, ${bytes("14", 20)}, now(), now())`;
  await client`insert into crest_accounts
    (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (${ids.account}, 4663, ${accountAddress}, ${ids.owner}, ${bytes("07", 32)}, 62692076, '1', ${bytes("08", 32)}, 1, 'active')`;
  await client`insert into policies
    (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad, effective_block_number, effective_block_hash, activated_at)
    values (${ids.policy}, ${ids.account}, 1, 2, '{}'::jsonb, ${bytes("09", 32)}, 'manual', 'active', ${marketId}, ${ids.vault}, ${ids.loanToken}, 625000000000000000, 62692076, ${bytes("02", 32)}, now())`;
});

afterAll(async () => {
  await client.end();
});

describe("lossless PostgreSQL boundaries", () => {
  test("restores numeric(78,0) policy values as bigint", async () => {
    const huge = 10n ** 70n;
    await client`insert into market_policies (policy_id, max_collateral_assets, debt_ceiling_assets, enabled)
      values (${ids.policy}, ${huge.toString()}, ${(huge - 1n).toString()}, true)`;

    const [policy] = await db.select().from(policies).where(eq(policies.id, ids.policy));
    const [marketPolicy] = await db.select().from(marketPolicies).where(eq(marketPolicies.policyId, ids.policy));
    expect(policy?.marketLltvWad).toBe(625_000_000_000_000_000n);
    expect(marketPolicy?.maxCollateralAssets).toBe(huge);
    expect(marketPolicy?.debtCeilingAssets).toBe(huge - 1n);
  });

  test("restores an explicit rate numerator and scale without precision loss", async () => {
    const rateValue = 36_466_465_324_746_133n;
    const rateScale = 1_000_000_000_000_000_000n;
    const [inserted] = await db.insert(rateObservations).values({
      subjectKind: "vault",
      vaultDeploymentId: ids.vault,
      rateValue,
      rateScale,
      periodKind: "apy-compounded",
      grossOrNet: "net",
      sourceUrl: "https://example.com/rate",
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      status: "normal",
    }).returning();

    expect(inserted?.rateValue).toBe(rateValue);
    expect(inserted?.rateScale).toBe(rateScale);
  });

  test("rejects a vault whose asset differs from the market loan token", async () => {
    await expect(client`insert into policies
      (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad)
      values (${randomUUID()}, ${ids.account}, 2, 2, '{}'::jsonb, ${bytes("0a", 32)}, 'manual', 'pending', ${marketId}, ${ids.wrongVault}, ${ids.loanToken}, 625000000000000000)`)
      .rejects.toMatchObject({ code: "23503" });
  });

  test("rejects invalid LTV ordering", async () => {
    await expect(client`insert into ltv_policies
      (policy_id, lower_ltv_wad, target_ltv_wad, upper_ltv_wad, critical_ltv_wad, market_lltv_wad)
      values (${ids.policy}, 300000000000000000, 300000000000000000, 420000000000000000, 500000000000000000, 625000000000000000)`)
      .rejects.toMatchObject({ code: "23514" });
  });

  test("rejects projected capacity when an assessment is degraded", async () => {
    await expect(client`insert into risk_assessments
      (id, crest_account_id, policy_id, risk_engine_version, status, owner_borrow_capacity_assets, repay_capacity_assets, estimated_annual_carry_assets, estimated_spread_bps, recommended_action, canonical_input_hash, created_at)
      values (${ids.assessment}, ${ids.account}, ${ids.policy}, '1', 'DEGRADED', 1, 0, 0, 0, 'freeze', ${bytes("0b", 32)}, now())`)
      .rejects.toMatchObject({ code: "23514" });
  });

  test("rejects projected data from realized debt repayment rows", async () => {
    await expect(client`insert into realized_strategy_events
      (id, crest_account_id, kind, transaction_hash, shares_before, shares_after, assets_before, assets_after, debt_before_assets, debt_after_assets, debt_repaid_assets, block_number, block_hash, block_time, canonical, observed_at)
      values (${randomUUID()}, ${ids.account}, 'repay', ${bytes("0c", 32)}, 1, 0, 1, 0, 100, 100, 0, 62692076, ${bytes("02", 32)}, now(), true, now())`)
      .rejects.toMatchObject({ code: "23514" });
  });

  test("rejects every Guardian selector outside the three-method boundary", async () => {
    const assessmentId = randomUUID();
    await client`insert into risk_assessments
      (id, crest_account_id, policy_id, risk_engine_version, status, owner_borrow_capacity_assets, repay_capacity_assets, estimated_annual_carry_assets, estimated_spread_bps, recommended_action, canonical_input_hash, created_at)
      values (${assessmentId}, ${ids.account}, ${ids.policy}, '1', 'NORMAL', 0, 0, 0, 0, 'none', ${bytes("0d", 32)}, now())`;
    await client`insert into automation_triggers
      (id, idempotency_key, assessment_id, policy_id, action_kind, status, detected_at)
      values (${ids.trigger}, ${bytes("0e", 32)}, ${assessmentId}, ${ids.policy}, 'freeze', 'detected', now())`;

    await expect(client`insert into automation_runs
      (id, trigger_id, status, guardian_address, selector, observed_policy_nonce, retry_count, started_at)
      values (${randomUUID()}, ${ids.trigger}, 'claimed', ${bytes("15", 20)}, 'borrowAndDeploy(uint256,uint256)', 1, 0, now())`)
      .rejects.toMatchObject({ code: "23514" });
  });
});
