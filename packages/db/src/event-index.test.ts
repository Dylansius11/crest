import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { createDatabase } from "./client.ts";
import {
  indexCrestEvents,
  isObservedStrategyDebtReduction,
  reconcileStrategyCostBasis,
  type IndexedCrestEvent,
} from "./event-index.ts";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { client, db } = createDatabase(databaseUrl);
const bytes = (digit: string, length: number) => Buffer.from(digit.repeat(length * 2), "hex");
const hash = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const uniqueAddress = () => `0x${randomUUID().replaceAll("-", "").padEnd(40, "0")}` as Address;
const uniqueHash = () => `0x${randomUUID().replaceAll("-", "").padEnd(64, "0")}` as Hex;
const ids = {
  loanAsset: randomUUID(), collateralAsset: randomUUID(), loanToken: randomUUID(), collateralToken: randomUUID(),
  morpho: randomUUID(), vault: randomUUID(), owner: randomUUID(), account: randomUUID(), policy: randomUUID(),
};
const accountAddress = uniqueAddress();
const vaultAddress = uniqueAddress();
const morphoAddress = uniqueAddress();
const loanTokenAddress = uniqueAddress();
const collateralTokenAddress = uniqueAddress();
const ownerAddress = uniqueAddress();
const marketId = uniqueHash();
const policyHash = uniqueHash();

const policyEventAbi = [{
  type: "event", name: "PolicyConfigured", inputs: [
    { name: "policyNonce", type: "uint64", indexed: true },
    { name: "marketId", type: "bytes32", indexed: true },
    { name: "yieldVault", type: "address", indexed: true },
    { name: "policyHash", type: "bytes32", indexed: false },
  ],
}] as const;
const deployedEventAbi = [{
  type: "event", name: "BorrowedAndDeployed", inputs: [
    { name: "borrowedAssets", type: "uint256", indexed: false }, { name: "vaultShares", type: "uint256", indexed: false },
    { name: "debtAfter", type: "uint256", indexed: false }, { name: "strategyAssetsAfter", type: "uint256", indexed: false },
  ],
}] as const;
const strategyRepayEventAbi = [{
  type: "event", name: "RepaidFromStrategy", inputs: [
    { name: "actor", type: "address", indexed: true }, { name: "requestedAssets", type: "uint256", indexed: false },
    { name: "withdrawnAssets", type: "uint256", indexed: false }, { name: "burnedShares", type: "uint256", indexed: false },
    { name: "debtBefore", type: "uint256", indexed: false }, { name: "debtAfter", type: "uint256", indexed: false },
    { name: "strategyAssetsBefore", type: "uint256", indexed: false }, { name: "strategyAssetsAfter", type: "uint256", indexed: false },
  ],
}] as const;

const event = (overrides: Partial<IndexedCrestEvent> = {}): IndexedCrestEvent => ({
  id: "0x01:0", blockNumber: 10n, logIndex: 0, canonical: true, kind: "BorrowedAndDeployed", assets: 100n, shares: 100n, ...overrides,
});

beforeAll(async () => {
  await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
    values (4663, ${`event-index-${ids.account}`}, 'Event index', 'ETH', 20, true)
    on conflict (chain_id) do nothing`;
  await client`insert into assets (id, canonical_symbol, kind, metadata_json)
    values (${ids.loanAsset}, 'USDG', 'stablecoin', '{}'::jsonb), (${ids.collateralAsset}, 'AAPL', 'stock_token', '{}'::jsonb)`;
  await client`insert into token_deployments
    (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${ids.loanToken}, ${ids.loanAsset}, 4663, ${Buffer.from(loanTokenAddress.slice(2), 'hex')}, 6, ${bytes('2', 32)}, 'https://example.test/loan', 100, ${bytes('3', 32)}, now(), 'verified'),
           (${ids.collateralToken}, ${ids.collateralAsset}, 4663, ${Buffer.from(collateralTokenAddress.slice(2), 'hex')}, 18, ${bytes('5', 32)}, 'https://example.test/collateral', 100, ${bytes('3', 32)}, now(), 'verified')`;
  await client`insert into morpho_deployments
    (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${ids.morpho}, 4663, ${Buffer.from(morphoAddress.slice(2), 'hex')}, ${bytes('6', 32)}, 'blue', 'https://example.test/morpho', 100, ${bytes('3', 32)}, now(), 'verified')`;
  await client`insert into morpho_markets
    (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
    values (${Buffer.from(marketId.slice(2), 'hex')}, ${ids.morpho}, ${ids.loanToken}, ${ids.collateralToken}, ${bytes('7', 20)}, ${bytes('8', 20)}, 625000000000000000, true, 'verified', now())`;
  await client`insert into vault_deployments
    (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${ids.vault}, 4663, ${Buffer.from(vaultAddress.slice(2), 'hex')}, ${ids.loanToken}, 18, 'erc4626', ${bytes('9', 32)}, 'none', '{}'::jsonb, 'https://example.test/vault', 100, ${bytes('3', 32)}, now(), 'verified')`;
  await client`insert into owners (id, address, first_seen_at, last_seen_at)
    values (${ids.owner}, ${Buffer.from(ownerAddress.slice(2), 'hex')}, now(), now())`;
  await client`insert into crest_accounts
    (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (${ids.account}, 4663, ${Buffer.from(accountAddress.slice(2), 'hex')}, ${ids.owner}, ${bytes('f', 32)}, 100, '1', ${bytes('a', 32)}, 0, 'active')`;
  await client`insert into policies
    (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, policy_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad)
    values (${ids.policy}, ${ids.account}, 1, 2, '{}'::jsonb, ${bytes('b', 32)}, ${Buffer.from(policyHash.slice(2), 'hex')}, 'manual', 'pending', ${Buffer.from(marketId.slice(2), 'hex')}, ${ids.vault}, ${ids.loanToken}, 625000000000000000)`;
});

afterAll(async () => { await client.end(); });

describe("canonical Crest event accounting", () => {
  test("replay deduplicates a log by transaction hash and log index", () => {
    expect(reconcileStrategyCostBasis({ completeHistory: true, policyActivated: true, events: [event(), event()] })).toBe(100n);
  });

  test("uses the canonical replacement after a reorg", () => {
    expect(reconcileStrategyCostBasis({ completeHistory: true, policyActivated: true, events: [event({ id: "0xdead:0", canonical: false }), event({ id: "0xbeef:0", assets: 80n, shares: 80n })] })).toBe(80n);
  });

  test("reduces principal pro rata by burned shares and fails closed on overburn", () => {
    expect(reconcileStrategyCostBasis({ completeHistory: true, policyActivated: true, events: [event(), event({ id: "0x02:0", blockNumber: 11n, kind: "StrategyWithdrawn", assets: 11n, shares: 10n })] })).toBe(90n);
    expect(reconcileStrategyCostBasis({ completeHistory: true, policyActivated: true, events: [event(), event({ id: "0x03:0", blockNumber: 12n, kind: "RepaidFromStrategy", assets: 110n, shares: 100n })] })).toBe(0n);
    expect(reconcileStrategyCostBasis({ completeHistory: true, policyActivated: true, events: [event(), event({ id: "0x04:0", blockNumber: 13n, kind: "StrategyWithdrawn", assets: 1n, shares: 101n })] })).toBeNull();
  });

  test("attributes realized repayment only to a canonical successful receipt with an observed accrued debt delta", () => {
    expect(isObservedStrategyDebtReduction({ canonical: true, receiptSucceeded: true, debtBeforeAssets: 100n, debtAfterAssets: 60n })).toBe(40n);
    expect(isObservedStrategyDebtReduction({ canonical: true, receiptSucceeded: false, debtBeforeAssets: 100n, debtAfterAssets: 60n })).toBeNull();
    expect(isObservedStrategyDebtReduction({ canonical: true, receiptSucceeded: true, debtBeforeAssets: 100n, debtAfterAssets: 100n })).toBeNull();
  });

  test("decodes bounded log ranges and atomically replays canonical events into one database cursor", async () => {
    const policyLog = {
      address: accountAddress, blockHash: hash(100n), blockNumber: 100n, transactionHash: hash(101n), logIndex: 0,
      topics: encodeEventTopics({ abi: policyEventAbi, eventName: "PolicyConfigured", args: { policyNonce: 1n, marketId, yieldVault: vaultAddress } }),
      data: encodeAbiParameters([{ type: "bytes32" }], [policyHash]),
    };
    const deployedLog = {
      address: accountAddress, blockHash: hash(101n), blockNumber: 101n, transactionHash: hash(102n), logIndex: 0,
      topics: encodeEventTopics({ abi: deployedEventAbi, eventName: "BorrowedAndDeployed" }),
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [50n, 50n, 50n, 50n]),
    };
    const repaidLog = {
      address: accountAddress, blockHash: hash(102n), blockNumber: 102n, transactionHash: hash(103n), logIndex: 0,
      topics: encodeEventTopics({ abi: strategyRepayEventAbi, eventName: "RepaidFromStrategy", args: { actor: ownerAddress } }),
      data: encodeAbiParameters([
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
      ], [25n, 25n, 10n, 50n, 25n, 50n, 25n]),
    };
    const ranges: Array<{ fromBlock: bigint; toBlock: bigint; topics?: unknown }> = [];
    const publicClient = {
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: hash(blockNumber), timestamp: 1_700_000_000n }),
      getLogs: async ({ address: logAddress, fromBlock, toBlock, topics }: { address: Address; fromBlock: bigint; toBlock: bigint; topics?: unknown }) => {
        ranges.push({ fromBlock, toBlock, topics });
        return logAddress === accountAddress ? [policyLog, deployedLog, repaidLog].filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock) : [];
      },
      getTransactionReceipt: async ({ hash: transactionHash }: { hash: Hex }) => {
        if (transactionHash !== repaidLog.transactionHash) throw new Error("unexpected receipt");
        return { status: "success", blockHash: repaidLog.blockHash, logs: [{ logIndex: repaidLog.logIndex }] };
      },
    };

    const input = { db, client: publicClient as never, crestAccountId: ids.account, crestAccountAddress: accountAddress, marketId, deploymentBlock: 100n, finalizedBlock: { number: 2_100n, hash: hash(2_100n) } };
    await expect(indexCrestEvents(input)).resolves.toEqual({ strategyCostBasisAssets: 40n, indexedPolicyNonce: 1n });
    await expect(indexCrestEvents(input)).resolves.toEqual({ strategyCostBasisAssets: 40n, indexedPolicyNonce: 1n });
    const [events] = await client`select count(*)::int as count from canonical_account_events where crest_account_id = ${ids.account} and canonical`;
    const [realized] = await client`select debt_repaid_assets as debt, shares_before, shares_after from realized_strategy_events where crest_account_id = ${ids.account} and canonical`;
    const [cursor] = await client`select last_canonical_block_number as block from indexer_cursors where chain_id = 4663 and stream_key = ${`crest:${ids.account}:${marketId}`}`;
    expect(ranges).toHaveLength(30);
    expect(ranges.every((range) => range.topics !== undefined)).toBe(true);
    expect(events?.count).toBe(3);
    expect(realized).toEqual({ debt: "25", shares_before: null, shares_after: null });
    expect(cursor?.block).toBe("2100");
    const snapshotHash = Buffer.from(hash(150n).slice(2), "hex");
    const [accountSnapshot] = await client`
      insert into account_snapshots
        (crest_account_id, owner_address, guardian_address, market_id, vault_deployment_id, max_collateral_assets, debt_ceiling_assets, max_strategy_assets, reserve_floor_assets, strategy_floor_assets, max_repay_per_action_assets, lower_ltv_wad, target_ltv_wad, upper_ltv_wad, critical_ltv_wad, borrowing_frozen, policy_nonce, loan_token_balance, block_number, block_hash, block_time, canonical, observed_at, provider_key)
      values
        (${ids.account}, ${Buffer.from(ownerAddress.slice(2), "hex")}, ${Buffer.from(ownerAddress.slice(2), "hex")}, ${Buffer.from(marketId.slice(2), "hex")}, ${ids.vault}, 100, 100, 100, 0, 0, 1, 100000000000000000, 200000000000000000, 300000000000000000, 400000000000000000, false, 1, 0, 150, ${snapshotHash}, now(), true, now(), 'event-index-test')
      returning id`;
    const [positionSnapshot] = await client`
      insert into position_snapshots
        (crest_account_id, market_id, borrow_shares, borrow_assets_up, collateral_assets, block_number, block_hash, block_time, canonical, observed_at, provider_key)
      values (${ids.account}, ${Buffer.from(marketId.slice(2), "hex")}, 1, 1, 1, 150, ${snapshotHash}, now(), true, now(), 'event-index-test')
      returning id`;
    const [strategySnapshot] = await client`
      insert into strategy_position_snapshots
        (crest_account_id, vault_deployment_id, share_balance, quoted_assets, max_withdrawable_assets, strategy_floor_assets, actionable_assets, block_number, block_hash, block_time, canonical, observed_at, provider_key)
      values (${ids.account}, ${ids.vault}, 1, 1, 1, 0, 1, 150, ${snapshotHash}, now(), true, now(), 'event-index-test')
      returning id`;
    const assessmentId = `event-index-${randomUUID()}`;
    await client`
      insert into risk_assessments
        (id, crest_account_id, policy_id, account_snapshot_id, position_snapshot_id, strategy_position_snapshot_id, risk_engine_version, status, owner_borrow_capacity_assets, repay_capacity_assets, recommended_action, input_json, canonical_input_hash, created_at)
      values (${assessmentId}, ${ids.account}, ${ids.policy}, ${accountSnapshot!.id}, ${positionSnapshot!.id}, ${strategySnapshot!.id}, '1', 'NORMAL', 0, 0, 'none', '{}'::jsonb, ${bytes('c', 32)}, now())`;
    const triggerId = `event-index-${randomUUID()}`;
    await client`
      insert into automation_triggers (id, idempotency_key, assessment_id, policy_id, action_kind, status, detected_at)
      values (${triggerId}, ${Buffer.from(uniqueHash().slice(2), "hex")}, ${assessmentId}, ${ids.policy}, 'freeze', 'detected', now())`;

    const forkPolicyLog = { ...policyLog, blockHash: hash(1_100n) };
    const forkDeployedLog = { ...deployedLog, blockHash: hash(1_101n) };
    const forkRepaidLog = { ...repaidLog, blockHash: hash(1_102n) };
    const forkClient = {
      ...publicClient,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: blockNumber === 100n ? hash(1_100n) : blockNumber === 101n ? hash(1_101n) : blockNumber === 102n ? hash(1_102n) : hash(3_000n),
        timestamp: 1_700_000_000n,
      }),
      getLogs: async ({ address: logAddress, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) => {
        ranges.push({ fromBlock, toBlock });
        return logAddress === accountAddress ? [forkPolicyLog, forkDeployedLog, forkRepaidLog].filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock) : [];
      },
      getTransactionReceipt: async ({ hash: transactionHash }: { hash: Hex }) => {
        if (transactionHash !== forkRepaidLog.transactionHash) throw new Error("unexpected receipt");
        return { status: "success", blockHash: forkRepaidLog.blockHash, logs: [{ logIndex: forkRepaidLog.logIndex }] };
      },
    };
    await expect(indexCrestEvents({ ...input, client: forkClient as never, finalizedBlock: { number: 2_100n, hash: hash(3_000n) } })).resolves.toEqual({
      strategyCostBasisAssets: 40n,
      indexedPolicyNonce: 1n,
    });
    const [forkRows] = await client`
      select count(*)::int as total, count(*) filter (where canonical)::int as canonical, count(*) filter (where not canonical)::int as reorged
      from canonical_account_events where crest_account_id = ${ids.account}`;
    expect(ranges).toHaveLength(45);
    expect(forkRows).toEqual({ total: 6, canonical: 3, reorged: 3 });
    const [reorgedInputs] = await client`
      select
        (select canonical from account_snapshots where id = ${accountSnapshot!.id}) as account_canonical,
        (select canonical from position_snapshots where id = ${positionSnapshot!.id}) as position_canonical,
        (select canonical from strategy_position_snapshots where id = ${strategySnapshot!.id}) as strategy_canonical,
        (select invalidated_at is not null from risk_assessments where id = ${assessmentId}) as assessment_invalidated,
        (select status from automation_triggers where id = ${triggerId}) as trigger_status`;
    expect(reorgedInputs).toEqual({
      account_canonical: false,
      position_canonical: false,
      strategy_canonical: false,
      assessment_invalidated: true,
      trigger_status: "superseded",
    });
    const nextPolicyId = randomUUID();
    const nextPolicyHash = uniqueHash();
    const supersededAssessmentId = `event-index-${randomUUID()}`;
    const supersededTriggerId = `event-index-${randomUUID()}`;
    await client`
      insert into policies
        (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, policy_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad)
      values (${nextPolicyId}, ${ids.account}, 2, 2, '{}'::jsonb, ${Buffer.from(uniqueHash().slice(2), "hex")}, ${Buffer.from(nextPolicyHash.slice(2), "hex")}, 'manual', 'pending', ${Buffer.from(marketId.slice(2), "hex")}, ${ids.vault}, ${ids.loanToken}, 625000000000000000)`;
    await client`
      insert into risk_assessments
        (id, crest_account_id, policy_id, risk_engine_version, status, owner_borrow_capacity_assets, repay_capacity_assets, recommended_action, input_json, canonical_input_hash, created_at)
      values (${supersededAssessmentId}, ${ids.account}, ${ids.policy}, '1', 'NORMAL', 0, 0, 'none', '{}'::jsonb, ${Buffer.from(uniqueHash().slice(2), "hex")}, now())`;
    await client`
      insert into automation_triggers (id, idempotency_key, assessment_id, policy_id, action_kind, status, detected_at)
      values (${supersededTriggerId}, ${Buffer.from(uniqueHash().slice(2), "hex")}, ${supersededAssessmentId}, ${ids.policy}, 'freeze', 'detected', now())`;
    const nextPolicyLog = {
      address: accountAddress, blockHash: hash(1_103n), blockNumber: 103n, transactionHash: hash(105n), logIndex: 0,
      topics: encodeEventTopics({ abi: policyEventAbi, eventName: "PolicyConfigured", args: { policyNonce: 2n, marketId, yieldVault: vaultAddress } }),
      data: encodeAbiParameters([{ type: "bytes32" }], [nextPolicyHash]),
    };
    const higherPolicyClient = {
      ...forkClient,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: blockNumber === 100n ? hash(1_100n) : blockNumber === 101n ? hash(1_101n) : blockNumber === 102n ? hash(1_102n) : blockNumber === 103n ? hash(1_103n) : hash(3_000n),
        timestamp: 1_700_000_000n,
      }),
      getLogs: async ({ address: logAddress, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) =>
        logAddress === accountAddress ? [forkPolicyLog, forkDeployedLog, forkRepaidLog, nextPolicyLog].filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock) : [],
    };
    await expect(indexCrestEvents({ ...input, client: higherPolicyClient as never, finalizedBlock: { number: 2_100n, hash: hash(3_000n) } }))
      .resolves.toEqual({ strategyCostBasisAssets: 40n, indexedPolicyNonce: 2n });
    const [supersededState] = await client`
      select
        (select status from policies where id = ${ids.policy}) as policy_status,
        (select invalidated_at is not null from risk_assessments where id = ${supersededAssessmentId}) as assessment_invalidated,
        (select status from automation_triggers where id = ${supersededTriggerId}) as trigger_status`;
    expect(supersededState).toEqual({ policy_status: "superseded", assessment_invalidated: true, trigger_status: "superseded" });
    const malformedClient = {
      ...forkClient,
      getLogs: async ({ address: logAddress, fromBlock, toBlock }: { address: Address; fromBlock: bigint; toBlock: bigint }) => {
        return logAddress === accountAddress
          ? [forkPolicyLog, forkDeployedLog, forkRepaidLog, { ...forkPolicyLog, transactionHash: hash(104n), logIndex: 1, data: "0x" }]
            .filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock)
          : [];
      },
    };
    await expect(indexCrestEvents({ ...input, client: malformedClient as never, finalizedBlock: { number: 2_100n, hash: hash(3_000n) } }))
      .rejects.toThrow("failed to decode relevant Crest event");
    await expect(indexCrestEvents({ ...input, finalizedBlock: { number: 1_000n, hash: hash(1_000n) } }))
      .rejects.toThrow("indexer cursor is ahead of the requested finalized block");
  });
});
