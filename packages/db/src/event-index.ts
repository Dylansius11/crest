import { sql, type SQL } from "drizzle-orm";
import { decodeEventLog, toEventSelector, type Address, type Hex, type Log, type PublicClient } from "viem";

/** The only Crest logs whose assets affect invested principal. */
type StrategyEventKind = "BorrowedAndDeployed" | "StrategyDeposited" | "StrategyWithdrawn" | "RepaidFromStrategy";

export interface IndexedCrestEvent {
  id: string;
  blockNumber: bigint;
  logIndex: number;
  canonical: boolean;
  kind: StrategyEventKind;
  assets: bigint;
  shares: bigint;
}

export interface CostBasisHistory {
  completeHistory: boolean;
  policyActivated: boolean;
  events: readonly IndexedCrestEvent[];
}

/**
 * Reconciles only canonical, uniquely identified events. Withdrawal proceeds can
 * include yield, so they never make invested principal negative.
 */
export function reconcileStrategyCostBasis(history: CostBasisHistory): bigint | null {
  if (!history.completeHistory || !history.policyActivated) return null;

  const seen = new Set<string>();
  let principal = 0n;
  let shares = 0n;
  for (const event of [...history.events].sort(compareEvents)) {
    if (!event.canonical || seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.kind === "BorrowedAndDeployed" || event.kind === "StrategyDeposited") {
      principal += event.assets;
      shares += event.shares;
      continue;
    }
    if (event.shares > shares) return null;
    if (event.shares === shares) {
      principal = 0n;
      shares = 0n;
      continue;
    }
    principal = (principal * (shares - event.shares) + shares - 1n) / shares;
    shares -= event.shares;
  }
  return principal;
}

/** A repayment is realized only when its canonical receipt proves an accrued debt reduction. */
export function isObservedStrategyDebtReduction(input: {
  canonical: boolean;
  receiptSucceeded: boolean;
  debtBeforeAssets: bigint;
  debtAfterAssets: bigint;
}): bigint | null {
  if (!input.canonical || !input.receiptSucceeded || input.debtAfterAssets >= input.debtBeforeAssets) return null;
  return input.debtBeforeAssets - input.debtAfterAssets;
}

export interface FinalizedBlock {
  number: bigint;
  hash: Hex;
}

/** Structural subset satisfied by the Drizzle database returned by createDatabase. */
export interface EventIndexDatabase {
  execute(query: SQL): Promise<unknown>;
  transaction<T>(callback: (transaction: { execute(query: SQL): Promise<unknown> }) => Promise<T>): Promise<T>;
}

export type EventIndexPublicClient = Pick<PublicClient, "getBlock" | "getLogs" | "getTransactionReceipt">;

export interface CrestEventIndexInput {
  db: EventIndexDatabase;
  client: EventIndexPublicClient;
  crestAccountId: string;
  crestAccountAddress: Address;
  marketId: Hex;
  deploymentBlock: bigint;
  finalizedBlock: FinalizedBlock;
}

const crestAbi = [
  { type: "event", name: "PolicyConfigured", inputs: [{ name: "policyNonce", type: "uint64", indexed: true }, { name: "marketId", type: "bytes32", indexed: true }, { name: "yieldVault", type: "address", indexed: true }, { name: "policyHash", type: "bytes32", indexed: false }] },
  { type: "event", name: "BorrowedAndDeployed", inputs: [{ name: "borrowedAssets", type: "uint256", indexed: false }, { name: "vaultShares", type: "uint256", indexed: false }, { name: "debtAfter", type: "uint256", indexed: false }, { name: "strategyAssetsAfter", type: "uint256", indexed: false }] },
  { type: "event", name: "StrategyDeposited", inputs: [{ name: "assets", type: "uint256", indexed: false }, { name: "shares", type: "uint256", indexed: false }, { name: "strategyAssetsAfter", type: "uint256", indexed: false }] },
  { type: "event", name: "StrategyWithdrawn", inputs: [{ name: "assets", type: "uint256", indexed: false }, { name: "shares", type: "uint256", indexed: false }, { name: "receiver", type: "address", indexed: true }] },
  { type: "event", name: "RepaidFromStrategy", inputs: [{ name: "actor", type: "address", indexed: true }, { name: "requestedAssets", type: "uint256", indexed: false }, { name: "withdrawnAssets", type: "uint256", indexed: false }, { name: "burnedShares", type: "uint256", indexed: false }, { name: "debtBefore", type: "uint256", indexed: false }, { name: "debtAfter", type: "uint256", indexed: false }, { name: "strategyAssetsBefore", type: "uint256", indexed: false }, { name: "strategyAssetsAfter", type: "uint256", indexed: false }] },
] as const;

const relevantCrestTopics: Record<string, true> = {
  [toEventSelector("PolicyConfigured(uint64,bytes32,address,bytes32)").toLowerCase()]: true,
  [toEventSelector("BorrowedAndDeployed(uint256,uint256,uint256,uint256)").toLowerCase()]: true,
  [toEventSelector("StrategyDeposited(uint256,uint256,uint256)").toLowerCase()]: true,
  [toEventSelector("StrategyWithdrawn(uint256,uint256,address)").toLowerCase()]: true,
  [toEventSelector("RepaidFromStrategy(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)").toLowerCase()]: true,
};

const relevantCrestArgumentCounts: Record<string, number> = {
  PolicyConfigured: 4,
  BorrowedAndDeployed: 4,
  StrategyDeposited: 3,
  StrategyWithdrawn: 3,
  RepaidFromStrategy: 8,
};

const morphoBorrowTopic = toEventSelector("Borrow(bytes32,address,address,address,uint256,uint256)");
const morphoRepayTopic = toEventSelector("Repay(bytes32,address,address,uint256,uint256)");
const vaultDepositTopic = toEventSelector("Deposit(address,address,uint256,uint256)");
const vaultWithdrawTopic = toEventSelector("Withdraw(address,address,address,uint256,uint256)");

const morphoAbi = [
  { type: "event", name: "Borrow", inputs: [{ name: "id", type: "bytes32", indexed: true }, { name: "caller", type: "address", indexed: false }, { name: "onBehalf", type: "address", indexed: true }, { name: "receiver", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "shares", type: "uint256", indexed: false }] },
  { type: "event", name: "Repay", inputs: [{ name: "id", type: "bytes32", indexed: true }, { name: "caller", type: "address", indexed: true }, { name: "onBehalf", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "shares", type: "uint256", indexed: false }] },
] as const;

const vaultAbi = [
  { type: "event", name: "Deposit", inputs: [{ name: "sender", type: "address", indexed: true }, { name: "owner", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "shares", type: "uint256", indexed: false }] },
  { type: "event", name: "Withdraw", inputs: [{ name: "sender", type: "address", indexed: true }, { name: "receiver", type: "address", indexed: true }, { name: "owner", type: "address", indexed: true }, { name: "assets", type: "uint256", indexed: false }, { name: "shares", type: "uint256", indexed: false }] },
] as const;

type EventKind =
  | StrategyEventKind
  | "PolicyConfigured"
  | "MorphoBorrow"
  | "MorphoRepay"
  | "VaultDeposit"
  | "VaultWithdraw";

interface CanonicalAccountEvent {
  id: string;
  kind: EventKind;
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  blockTime: Date;
  payload: Record<string, string>;
}

interface AccountRow {
  chainId: bigint;
  address: Uint8Array;
}

interface RouteRow {
  morphoAddress: Uint8Array;
  vaultAddress: Uint8Array;
}

interface CursorRow {
  blockNumber: bigint;
  blockHash: Uint8Array;
}

/**
 * Reads the entire finalized account history on every run. This intentionally
 * favors a complete, auditable history over a partial cursor range: the cursor
 * is a reorg detector and atomically committed checkpoint, not a source of
 * unverified accounting.
 */
export async function indexCrestEvents(input: CrestEventIndexInput): Promise<{
  strategyCostBasisAssets: bigint | null;
  indexedPolicyNonce: bigint | null;
}> {
  if (input.deploymentBlock > input.finalizedBlock.number) {
    return { strategyCostBasisAssets: null, indexedPolicyNonce: null };
  }

  const account = await queryRows<AccountRow>(input.db, sql`
    select chain_id as "chainId", address
    from crest_accounts
    where id = ${input.crestAccountId}
  `).then(one("unknown Crest account"));
  if (toHex(account.address) !== input.crestAccountAddress.toLowerCase()) {
    throw new Error("Crest account registry address does not match index input");
  }
  const chainId = BigInt(account.chainId);

  const routeRows = await queryRows<RouteRow>(input.db, sql`
    select md.address as "morphoAddress", vd.address as "vaultAddress"
    from policies p
    join vault_deployments vd on vd.id = p.vault_deployment_id
    join morpho_markets mm on mm.id = p.market_id
    join morpho_deployments md on md.id = mm.morpho_deployment_id
    where p.crest_account_id = ${input.crestAccountId}
      and p.market_id = ${bytea(input.marketId)}
  `);
  const routes = uniqueRoutes(routeRows);
  if (routes.length !== 1) throw new Error("Crest account must have one exact registered Morpho market and vault");
  const route = routes[0]!;

  const finalized = await input.client.getBlock({ blockNumber: input.finalizedBlock.number });
  if (finalized.hash.toLowerCase() !== input.finalizedBlock.hash.toLowerCase()) {
    throw new Error("provided finalized block hash is not canonical");
  }

  const streamKey = `crest:${input.crestAccountId}:${input.marketId.toLowerCase()}`;
  const cursor = await queryRows<CursorRow>(input.db, sql`
    select last_canonical_block_number as "blockNumber", last_canonical_block_hash as "blockHash"
    from indexer_cursors
    where chain_id = ${chainId.toString()} and stream_key = ${streamKey}
  `).then(optionalOne);
  if (cursor !== null && BigInt(cursor.blockNumber) > input.finalizedBlock.number) {
    throw new Error("indexer cursor is ahead of the requested finalized block");
  }
  const reorged = cursor ? !(await matchesCanonicalBlock(input.client, cursor)) : false;

  const [crestLogs, morphoBorrowLogs, morphoRepayLogs, vaultDepositLogs, vaultWithdrawLogs] = await Promise.all([
    getLogsInRanges(input.client, input.crestAccountAddress, input.deploymentBlock, input.finalizedBlock.number, [Object.keys(relevantCrestTopics) as Hex[]]),
    getLogsInRanges(input.client, route.morphoAddress, input.deploymentBlock, input.finalizedBlock.number, [morphoBorrowTopic, input.marketId, input.crestAccountAddress]),
    getLogsInRanges(input.client, route.morphoAddress, input.deploymentBlock, input.finalizedBlock.number, [morphoRepayTopic, null, input.crestAccountAddress]),
    getLogsInRanges(input.client, route.vaultAddress, input.deploymentBlock, input.finalizedBlock.number, [vaultDepositTopic, input.crestAccountAddress]),
    getLogsInRanges(input.client, route.vaultAddress, input.deploymentBlock, input.finalizedBlock.number, [vaultWithdrawTopic, null, input.crestAccountAddress]),
  ]);

  const events = await decodeCanonicalEvents({
    client: input.client,
    accountAddress: input.crestAccountAddress,
    marketId: input.marketId,
    crestLogs,
    morphoLogs: [...morphoBorrowLogs, ...morphoRepayLogs],
    vaultLogs: [...vaultDepositLogs, ...vaultWithdrawLogs],
  });
  const activatedPolicies = events.filter((event) => event.kind === "PolicyConfigured"
    && event.payload.marketId?.toLowerCase() === input.marketId.toLowerCase()
    && event.payload.yieldVault?.toLowerCase() === route.vaultAddress.toLowerCase());

  const activation = await input.db.transaction(async (transaction) => {
    if (reorged) await markReorged(transaction, input.crestAccountId, input.deploymentBlock, input.marketId, route.vaultAddress);

    for (const event of events) {
      await persistCanonicalEvent(transaction, input.crestAccountId, event);
      await persistConfirmedStrategyRepayment(transaction, input.crestAccountId, event);
    }

    let indexedPolicyNonce: bigint | null = null;
    for (const policyEvent of activatedPolicies) {
      const policyNonce = policyEvent.payload.policyNonce;
      const policyHash = policyEvent.payload.policyHash;
      if (policyNonce === undefined || policyHash === undefined) continue;
      const activated = await queryRows<{ policyNonce: bigint | string }>(transaction, sql`
        update policies
        set status = 'active', effective_block_number = ${policyEvent.blockNumber.toString()}, effective_block_hash = ${bytea(policyEvent.blockHash)}, activated_at = ${policyEvent.blockTime.toISOString()}, invalidated_at = null
        where crest_account_id = ${input.crestAccountId}
          and policy_nonce = ${BigInt(policyNonce).toString()}
          and policy_hash = ${bytea(policyHash as Hex)}
          and market_id = ${bytea(input.marketId)}
          and vault_deployment_id in (select id from vault_deployments where address = ${bytea(route.vaultAddress)})
        returning policy_nonce as "policyNonce"
      `);
      if (activated.length === 1) {
        indexedPolicyNonce = BigInt(activated[0]!.policyNonce);
        const superseded = await queryRows<{ id: string }>(transaction, sql`
          update policies
          set status = 'superseded'
          where crest_account_id = ${input.crestAccountId}
            and status = 'active'
            and policy_nonce < ${indexedPolicyNonce.toString()}
          returning id
        `);
        for (const policy of superseded) {
          await transaction.execute(sql`
            update risk_assessments
            set invalidated_at = ${new Date().toISOString()}, invalidation_reason = 'policy_superseded'
            where policy_id = ${policy.id} and invalidated_at is null
          `);
          await transaction.execute(sql`
            update automation_triggers
            set status = 'superseded'
            where policy_id = ${policy.id} and status = 'detected'
          `);
        }
      }
    }

    if (indexedPolicyNonce !== null) await transaction.execute(sql`
      update crest_accounts
      set indexed_policy_nonce = ${indexedPolicyNonce.toString()}
      where id = ${input.crestAccountId}
    `);

    await transaction.execute(sql`
      insert into indexer_cursors (chain_id, stream_key, last_canonical_block_number, last_canonical_block_hash, updated_at)
      values (${chainId.toString()}, ${streamKey}, ${input.finalizedBlock.number.toString()}, ${bytea(input.finalizedBlock.hash)}, ${new Date().toISOString()})
      on conflict (chain_id, stream_key) do update set
        last_canonical_block_number = excluded.last_canonical_block_number,
        last_canonical_block_hash = excluded.last_canonical_block_hash,
        updated_at = excluded.updated_at
    `);
    return indexedPolicyNonce;
  });

  const policyActivated = activatedPolicies.length > 0 && activation !== null;
  return {
    strategyCostBasisAssets: reconcileStrategyCostBasis({
      completeHistory: true,
      policyActivated,
      events: events.flatMap(toStrategyEvent),
    }),
    indexedPolicyNonce: activation,
  };
}

async function decodeCanonicalEvents(input: {
  client: EventIndexPublicClient;
  accountAddress: Address;
  marketId: Hex;
  crestLogs: readonly Log[];
  morphoLogs: readonly Log[];
  vaultLogs: readonly Log[];
}): Promise<CanonicalAccountEvent[]> {
  const candidates = [
    ...input.crestLogs.flatMap((log) => decodeLog(log, crestAbi, "crest", input)),
    ...input.morphoLogs.flatMap((log) => decodeLog(log, morphoAbi, "morpho", input)),
    ...input.vaultLogs.flatMap((log) => decodeLog(log, vaultAbi, "vault", input)),
  ].sort(compareEvents);

  const blocks = new Map<string, Date>();
  for (const event of candidates) {
    const key = `${event.blockNumber}:${event.blockHash}`;
    if (blocks.has(key)) continue;
    const block = await input.client.getBlock({ blockNumber: event.blockNumber });
    if (block.hash.toLowerCase() !== event.blockHash.toLowerCase()) {
      throw new Error(`event ${event.id} is not on the canonical chain`);
    }
    blocks.set(key, new Date(Number(block.timestamp) * 1_000));
  }

  return Promise.all(candidates.map(async (event) => {
    const payload = { ...event.payload };
    if (event.kind === "RepaidFromStrategy") {
      try {
        const receipt = await input.client.getTransactionReceipt({ hash: event.transactionHash });
        const receiptConfirmed = receipt.status === "success"
          && receipt.blockHash.toLowerCase() === event.blockHash.toLowerCase()
          && receipt.logs.some((log) => log.logIndex === event.logIndex);
        payload.receiptStatus = receiptConfirmed ? "confirmed" : "unconfirmed";
        const debtBefore = payload.debtBefore;
        const debtAfter = payload.debtAfter;
        if (debtBefore !== undefined && debtAfter !== undefined) {
          const debtRepaid = isObservedStrategyDebtReduction({
            canonical: true,
            receiptSucceeded: receiptConfirmed,
            debtBeforeAssets: BigInt(debtBefore),
            debtAfterAssets: BigInt(debtAfter),
          });
          if (debtRepaid !== null) payload.observedDebtRepaidAssets = debtRepaid.toString();
        }
      } catch {
        payload.receiptStatus = "unconfirmed";
      }
    }
    return { ...event, blockTime: blocks.get(`${event.blockNumber}:${event.blockHash}`)!, payload };
  }));
}

async function getLogsInRanges(
  client: EventIndexPublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
  topics: readonly (Hex | readonly Hex[] | null)[],
): Promise<readonly Log[]> {
  const logs: Log[] = [];
  const getLogs = client.getLogs as unknown as (parameters: {
    address: Address;
    fromBlock: bigint;
    toBlock: bigint;
    topics: readonly (Hex | readonly Hex[] | null)[];
  }) => Promise<readonly Log[]>;
  for (let start = fromBlock; start <= toBlock; start += 1_000n) {
    const end = start + 999n > toBlock ? toBlock : start + 999n;
    logs.push(...await getLogs({ address, fromBlock: start, toBlock: end, topics }));
  }
  return logs;
}

function decodeLog(log: Log, abi: readonly unknown[], source: "crest" | "morpho" | "vault", input: { accountAddress: Address; marketId: Hex }): Omit<CanonicalAccountEvent, "blockTime">[] {
  if (!log.transactionHash || log.logIndex === null || !log.blockHash || log.blockNumber === null) return [];
  try {
    const decoded = decodeEventLog({ abi: abi as never, data: log.data, topics: log.topics, strict: false }) as unknown as { eventName: string; args: Record<string, unknown> };
    const args = decoded.args;
    if (!isRelevant(decoded.eventName, args, source, input)) return [];
    if (source === "crest" && Object.keys(args).length !== relevantCrestArgumentCounts[decoded.eventName]) throw new Error(`incomplete ${decoded.eventName} arguments`);
    const kind = eventKind(decoded.eventName, source);
    if (kind === null) return [];
    return [{ id: `${log.transactionHash.toLowerCase()}:${log.logIndex}`, kind, transactionHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber, blockHash: log.blockHash, payload: jsonArguments(args) }];
  } catch (error) {
    if (source === "crest" && relevantCrestTopics[log.topics[0]?.toLowerCase() ?? ""]) throw new Error("failed to decode relevant Crest event", { cause: error });
    return [];
  }
}

function isRelevant(eventName: string, args: Record<string, unknown>, source: "crest" | "morpho" | "vault", input: { accountAddress: Address; marketId: Hex }): boolean {
  if (source === "crest") return eventKind(eventName, source) !== null;
  if (source === "morpho") return hex(args.id) === input.marketId.toLowerCase() && hex(args.onBehalf) === input.accountAddress.toLowerCase();
  return hex(args.owner) === input.accountAddress.toLowerCase();
}

function eventKind(eventName: string, source: "crest" | "morpho" | "vault"): EventKind | null {
  if (source === "crest" && ["PolicyConfigured", "BorrowedAndDeployed", "StrategyDeposited", "StrategyWithdrawn", "RepaidFromStrategy"].includes(eventName)) return eventName as EventKind;
  if (source === "morpho" && eventName === "Borrow") return "MorphoBorrow";
  if (source === "morpho" && eventName === "Repay") return "MorphoRepay";
  if (source === "vault" && eventName === "Deposit") return "VaultDeposit";
  if (source === "vault" && eventName === "Withdraw") return "VaultWithdraw";
  return null;
}

function toStrategyEvent(event: CanonicalAccountEvent): IndexedCrestEvent[] {
  const assets = event.kind === "RepaidFromStrategy" ? event.payload.withdrawnAssets : event.payload.borrowedAssets ?? event.payload.assets;
  const shares = event.kind === "RepaidFromStrategy" ? event.payload.burnedShares : event.payload.vaultShares ?? event.payload.shares;
  if ((event.kind !== "BorrowedAndDeployed" && event.kind !== "StrategyDeposited" && event.kind !== "StrategyWithdrawn" && event.kind !== "RepaidFromStrategy") || assets === undefined || shares === undefined) return [];
  return [{ id: event.id, blockNumber: event.blockNumber, logIndex: event.logIndex, canonical: true, kind: event.kind, assets: BigInt(assets), shares: BigInt(shares) }];
}

async function persistCanonicalEvent(transaction: { execute(query: SQL): Promise<unknown> }, crestAccountId: string, event: CanonicalAccountEvent): Promise<void> {
  await transaction.execute(sql`
    insert into canonical_account_events
      (crest_account_id, event_kind, transaction_hash, log_index, block_number, block_hash, block_time, canonical, reorged_at, payload_json, observed_at)
    values
      (${crestAccountId}, ${event.kind}, ${bytea(event.transactionHash)}, ${event.logIndex.toString()}, ${event.blockNumber.toString()}, ${bytea(event.blockHash)}, ${event.blockTime.toISOString()}, true, null, ${JSON.stringify(event.payload)}::jsonb, ${new Date().toISOString()})
    on conflict (crest_account_id, transaction_hash, log_index, block_hash) do update set
      event_kind = excluded.event_kind,
      block_number = excluded.block_number,
      block_hash = excluded.block_hash,
      block_time = excluded.block_time,
      canonical = true,
      reorged_at = null,
      payload_json = excluded.payload_json,
      observed_at = excluded.observed_at
  `);
}

async function persistConfirmedStrategyRepayment(transaction: { execute(query: SQL): Promise<unknown> }, crestAccountId: string, event: CanonicalAccountEvent): Promise<void> {
  if (event.kind !== "RepaidFromStrategy" || event.payload.receiptStatus !== "confirmed") return;
  const assetsBefore = event.payload.strategyAssetsBefore;
  const assetsAfter = event.payload.strategyAssetsAfter;
  const debtBefore = event.payload.debtBefore;
  const debtAfter = event.payload.debtAfter;
  if (assetsBefore === undefined || assetsAfter === undefined || debtBefore === undefined || debtAfter === undefined) return;
  const debtRepaid = isObservedStrategyDebtReduction({
    canonical: true,
    receiptSucceeded: true,
    debtBeforeAssets: BigInt(debtBefore),
    debtAfterAssets: BigInt(debtAfter),
  });
  if (debtRepaid === null) return;

  await transaction.execute(sql`
    insert into realized_strategy_events
      (crest_account_id, kind, transaction_hash, log_index, shares_before, shares_after, assets_before, assets_after, debt_before_assets, debt_after_assets, debt_repaid_assets, attributed_fees_assets, block_number, block_hash, block_time, canonical, observed_at, reorged_at)
    values
      (${crestAccountId}, 'repay', ${bytea(event.transactionHash)}, ${event.logIndex.toString()}, null, null, ${BigInt(assetsBefore).toString()}, ${BigInt(assetsAfter).toString()}, ${BigInt(debtBefore).toString()}, ${BigInt(debtAfter).toString()}, ${debtRepaid.toString()}, null, ${event.blockNumber.toString()}, ${bytea(event.blockHash)}, ${event.blockTime.toISOString()}, true, ${new Date().toISOString()}, null)
    on conflict (crest_account_id, transaction_hash, log_index, block_hash) do update set
      kind = excluded.kind, shares_before = null, shares_after = null, assets_before = excluded.assets_before, assets_after = excluded.assets_after,
      debt_before_assets = excluded.debt_before_assets, debt_after_assets = excluded.debt_after_assets, debt_repaid_assets = excluded.debt_repaid_assets,
      attributed_fees_assets = null, block_number = excluded.block_number, block_hash = excluded.block_hash, block_time = excluded.block_time,
      canonical = true, observed_at = excluded.observed_at, reorged_at = null
  `);
}

async function markReorged(transaction: { execute(query: SQL): Promise<unknown> }, crestAccountId: string, deploymentBlock: bigint, marketId: Hex, vaultAddress: Address): Promise<void> {
  const now = new Date().toISOString();
  const block = deploymentBlock.toString();
  await transaction.execute(sql`update canonical_account_events set canonical = false, reorged_at = ${now} where crest_account_id = ${crestAccountId} and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update realized_strategy_events set canonical = false, reorged_at = ${now} where crest_account_id = ${crestAccountId} and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update account_snapshots set canonical = false, reorged_at = ${now} where crest_account_id = ${crestAccountId} and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update position_snapshots set canonical = false, reorged_at = ${now} where crest_account_id = ${crestAccountId} and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update strategy_position_snapshots set canonical = false, reorged_at = ${now} where crest_account_id = ${crestAccountId} and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update market_snapshots set canonical = false, reorged_at = ${now} where market_id = ${bytea(marketId)} and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update vault_snapshots set canonical = false, reorged_at = ${now} where vault_deployment_id in (select id from vault_deployments where address = ${bytea(vaultAddress)}) and canonical and block_number >= ${block}`);
  await transaction.execute(sql`update policies set status = 'reorged', invalidated_at = ${now} where crest_account_id = ${crestAccountId} and status = 'active' and effective_block_number >= ${block}`);
  await transaction.execute(sql`update risk_assessments set invalidated_at = ${now}, invalidation_reason = 'canonical_event_reorg' where crest_account_id = ${crestAccountId} and invalidated_at is null`);
  await transaction.execute(sql`update automation_triggers t set status = 'superseded' from risk_assessments a where t.assessment_id = a.id and t.status = 'detected' and a.crest_account_id = ${crestAccountId}`);
}

async function matchesCanonicalBlock(client: EventIndexPublicClient, cursor: CursorRow): Promise<boolean> {
  try {
    const block = await client.getBlock({ blockNumber: BigInt(cursor.blockNumber) });
    return block.hash.toLowerCase() === toHex(cursor.blockHash);
  } catch {
    return false;
  }
}

async function queryRows<T>(executor: { execute(query: SQL): Promise<unknown> }, query: SQL): Promise<T[]> {
  const result = await executor.execute(query) as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : result.rows ?? [];
}

function one<T>(message: string) {
  return (rows: T[]): T => {
    if (rows.length !== 1) throw new Error(message);
    return rows[0]!;
  };
}

function optionalOne<T>(rows: T[]): T | null {
  if (rows.length > 1) throw new Error("expected at most one row");
  return rows[0] ?? null;
}

function uniqueRoutes(rows: RouteRow[]): { morphoAddress: Address; vaultAddress: Address }[] {
  const result = new Map<string, { morphoAddress: Address; vaultAddress: Address }>();
  for (const row of rows) {
    const route = { morphoAddress: toHex(row.morphoAddress) as Address, vaultAddress: toHex(row.vaultAddress) as Address };
    result.set(`${route.morphoAddress}:${route.vaultAddress}`, route);
  }
  return [...result.values()];
}

function jsonArguments(args: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : String(value)]));
}

function hex(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function bytea(value: Hex): SQL {
  return sql`decode(${value.slice(2)}, 'hex')`;
}

function toHex(value: Uint8Array): Hex {
  return `0x${Buffer.from(value).toString("hex")}` as Hex;
}

function compareEvents(left: { blockNumber: bigint; logIndex: number }, right: { blockNumber: bigint; logIndex: number }): number {
  if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1;
  return left.logIndex - right.logIndex;
}
