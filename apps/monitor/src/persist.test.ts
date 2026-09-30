import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDatabase } from "@crest/db";
import { fixture } from "@crest/risk/test-fixtures";
import { persistObservations } from "./persist.ts";

const { db, client } = createDatabase(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
const bytes = (hex: string) => Buffer.from(hex.slice(2), "hex");
const id = { loan: randomUUID(), collateral: randomUUID(), loanToken: randomUUID(), collateralToken: randomUUID(), morpho: randomUUID(), vault: randomUUID(), owner: randomUUID(), account: randomUUID() };
const input = fixture({ costBasisAssets: null });
input.oracle.marketPrice = { ...input.oracle.marketPrice, value: null, status: "unknown" };
input.strategy = { ...input.strategy, value: null, status: "unknown" };
if (input.account.value !== null) {
  input.account = {
    ...input.account,
    value: {
      ...input.account.value,
      policy: {
        ...input.policy.compiled.config,
        owner: input.policy.compiled.route.owner,
        market: input.policy.compiled.route.market,
        marketId: input.policy.compiled.route.marketId,
        yieldVault: input.policy.compiled.route.vault,
      },
    },
  };
}
const marketId = bytes(input.policy.compiled.route.marketId);
const salt = randomUUID().replaceAll("-", "");
const address = (suffix: string) => Buffer.from(`${salt}${suffix.padEnd(8, "0")}`.slice(0, 40), "hex");
const hash = Buffer.from(`${salt}${"0".repeat(64)}`.slice(0, 64), "hex");

beforeAll(async () => {
  await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
    values (4663, 'robinhood-mainnet', 'Robinhood Chain', 'ETH', 20, true) on conflict (chain_id) do nothing`;
  await client`insert into assets (id, canonical_symbol, kind, metadata_json) values
    (${id.loan}, 'USDG', 'stablecoin', '{}'::jsonb), (${id.collateral}, 'AAPL', 'stock_token', '{}'::jsonb)`;
  await client`insert into token_deployments
    (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.loanToken}, ${id.loan}, 4663, ${address("01")}, 6, ${hash}, 'https://example.com/loan', 1, ${hash}, now(), 'verified'),
    (${id.collateralToken}, ${id.collateral}, 4663, ${address("02")}, 18, ${hash}, 'https://example.com/collateral', 1, ${hash}, now(), 'verified')`;
  await client`insert into morpho_deployments
    (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.morpho}, 4663, ${address("03")}, ${hash}, 'blue', 'https://example.com/morpho', 1, ${hash}, now(), 'verified')`;
  await client`insert into morpho_markets
    (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
    values (${marketId}, ${id.morpho}, ${id.loanToken}, ${id.collateralToken}, ${address("04")}, ${address("05")}, 625000000000000000, true, 'verified', now())`;
  await client`insert into vault_deployments
    (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.vault}, 4663, ${address("06")}, ${id.loanToken}, 18, 'fixed_adapter', ${hash}, 'none', '{}'::jsonb, 'https://example.com/vault', 1, ${hash}, now(), 'verified')`;
  await client`insert into owners (id, address, first_seen_at, last_seen_at) values (${id.owner}, ${address("07")}, now(), now())`;
  await client`insert into crest_accounts
    (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (${id.account}, 4663, ${address("08")}, ${id.owner}, ${hash}, 1, '1', ${hash}, 1, 'active')`;
});

afterAll(async () => {
  await client`delete from rate_observations where vault_deployment_id = ${id.vault} or market_id = ${marketId}`;
  await client`delete from strategy_position_snapshots where crest_account_id = ${id.account}`;
  await client`delete from position_snapshots where crest_account_id = ${id.account}`;
  await client`delete from account_snapshots where crest_account_id = ${id.account}`;
  await client`delete from vault_snapshots where vault_deployment_id = ${id.vault}`;
  await client`delete from market_snapshots where market_id = ${marketId}`;
  await client`delete from crest_accounts where id = ${id.account}`;
  await client`delete from owners where id = ${id.owner}`;
  await client`delete from vault_deployments where id = ${id.vault}`;
  await client`delete from morpho_markets where id = ${marketId}`;
  await client`delete from morpho_deployments where id = ${id.morpho}`;
  await client`delete from token_deployments where id in (${id.loanToken}, ${id.collateralToken})`;
  await client`delete from assets where id in (${id.loan}, ${id.collateral})`;
  await client.end();
});

describe("pinned observation persistence", () => {
  test("same block replay references one immutable set of onchain snapshots; rates retain source and timestamp", async () => {
    const ids = { accountId: id.account, marketId, vaultId: id.vault };
    const first = await persistObservations(db, input, ids, 0n);
    const replay = await persistObservations(db, input, ids, 0n);
    expect(replay).toEqual(first);
    const snapshots = await client`select block_hash, total_borrow_assets from market_snapshots where market_id = ${marketId}`;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.total_borrow_assets).toBe(input.market.value?.accrued.totalBorrowAssets.toString());
    const accounts = await client`select policy_nonce, borrowing_frozen from account_snapshots where crest_account_id = ${id.account}`;
    const [observedAccount] = await client`select owner_address, guardian_address from account_snapshots where crest_account_id = ${id.account}`;
    expect(Buffer.from(observedAccount!.owner_address as Uint8Array)).toEqual(bytes(input.policy.compiled.route.owner));
    expect(Buffer.from(observedAccount!.guardian_address as Uint8Array)).toEqual(bytes(input.policy.compiled.config.guardian));
    expect(accounts).toEqual([{ policy_nonce: "1", borrowing_frozen: false }]);
    const rates = await client`select source_url, fetched_at, rate_value from rate_observations where market_id = ${marketId}`;
    expect(rates).toHaveLength(1);
    expect(rates[0]?.source_url).toBe(input.rates.borrow.provenance.kind === "http" ? input.rates.borrow.provenance.url : "");
    const [market] = await client`select oracle_value from market_snapshots where market_id = ${marketId}`;
    const [account] = await client`select vault_share_balance, collateral_token_balance from account_snapshots where crest_account_id = ${id.account}`;
    expect(market?.oracle_value).toBeNull();
    expect(account).toEqual({ vault_share_balance: null, collateral_token_balance: null });
  });

  test("a changed Morpho market at the same block hash cannot reuse its old snapshot", async () => {
    const changed = fixture({ costBasisAssets: null });
    changed.market = {
      ...changed.market,
      value: {
        ...changed.market.value!,
        accrued: { ...changed.market.value!.accrued, totalBorrowAssets: changed.market.value!.accrued.totalBorrowAssets + 1n },
      },
    };
    await expect(persistObservations(db, changed, { accountId: id.account, marketId, vaultId: id.vault }, 0n))
      .rejects.toThrow("market snapshot changed at the same block");
  });

  test("the same block cannot silently reuse a stale account freeze or vault balance", async () => {
    const changedAccount = {
      ...input,
      account: { ...input.account, value: { ...input.account.value!, borrowingFrozen: true } },
    };
    await expect(persistObservations(db, changedAccount, { accountId: id.account, marketId, vaultId: id.vault }, 0n))
      .rejects.toThrow("account snapshot changed at the same block");

    const changedVault = {
      ...input,
      vault: { ...input.vault, value: { ...input.vault.value!, totalAssets: input.vault.value!.totalAssets + 1n } },
    };
    await expect(persistObservations(db, changedVault, { accountId: id.account, marketId, vaultId: id.vault }, 0n))
      .rejects.toThrow("vault snapshot changed at the same block");
  });

  test("a changed Morpho position at the same block hash cannot reuse its old snapshot", async () => {
    const changed = {
      ...input,
      position: {
        ...input.position,
        value: { ...input.position.value!, borrowShares: input.position.value!.borrowShares + 1n },
      },
    };
    await expect(persistObservations(db, changed, { accountId: id.account, marketId, vaultId: id.vault }, 0n))
      .rejects.toThrow("position snapshot changed at the same block");
  });

  test("a changed strategy withdrawal limit at the same block hash cannot reuse its old snapshot", async () => {
    const fresh = fixture({ costBasisAssets: null });
    fresh.head = { ...fresh.head, value: { ...fresh.head.value!, block: { ...fresh.head.value!.block, hash: `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` } } };
    fresh.account = input.account;
    await persistObservations(db, fresh, { accountId: id.account, marketId, vaultId: id.vault }, 0n);
    const changed = {
      ...fresh,
      strategy: {
        ...fresh.strategy,
        value: { ...fresh.strategy.value!, availableAssets: fresh.strategy.value!.availableAssets + 1n },
      },
    };
    await expect(persistObservations(db, changed, { accountId: id.account, marketId, vaultId: id.vault }, 0n))
      .rejects.toThrow("strategy snapshot changed at the same block");
  });

  test("one provider timestamp cannot be reused for a different borrow rate", async () => {
    const changedRate = {
      ...input,
      rates: {
        ...input.rates,
        borrow: { ...input.rates.borrow, value: { ...input.rates.borrow.value!, value: input.rates.borrow.value!.value + 1n } },
      },
    };
    await expect(persistObservations(db, changedRate, { accountId: id.account, marketId, vaultId: id.vault }, 0n))
      .rejects.toThrow("rate observation changed at the same provider timestamp");
  });

});
