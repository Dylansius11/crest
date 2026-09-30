import { canonicalJson } from "@crest/domain";
import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema.ts";

type GuardianDatabase = PostgresJsDatabase<typeof schema>;
type GuardianActionKind = "freeze" | "repay_reserve" | "repay_strategy";
type GuardianSelector = "freezeBorrowing()" | "repayFromReserve(uint256)" | "repayFromStrategy(uint256)";
type PostconditionKind = "frozen" | "debt_decreased" | "reserve_floor_held" | "strategy_floor_held" | "vault_receiver_fixed" | "repay_beneficiary_fixed";
interface GuardianAttemptInput {
  runId: string;
  chainId: bigint;
  accountId: string;
  from: `0x${string}`;
  to: `0x${string}`;
  selector: GuardianSelector;
  calldataHash: `0x${string}`;
  simulationBlockNumber: bigint;
  simulationBlockHash: `0x${string}`;
  simulationGas: bigint | null;
  nonce: bigint | null;
  transactionHash: `0x${string}`;
}

type Executor = { execute(query: SQL): Promise<unknown> };

export interface GuardianClaim {
  runId: string;
  triggerId: string;
  actionKind: GuardianActionKind;
  requestedAssets: bigint | null;
  accountId: string;
  accountAddress: `0x${string}`;
  accountCodeHash: `0x${string}`;
  policyId: string;
  policyNonce: bigint;
  policyHash: `0x${string}`;
  marketId: `0x${string}`;
  assessmentId: string;
  idempotencyKey: `0x${string}`;
}

export async function claimGuardianTrigger(
  db: GuardianDatabase,
  input: { triggerId: string; chainId: bigint; accountAddress: `0x${string}`; guardianAddress: `0x${string}`; now: Date },
): Promise<GuardianClaim | null> {
  const accountAddress = bytea(input.accountAddress, 20);
  const guardianAddress = bytea(input.guardianAddress, 20);
  const recordedAt = input.now.toISOString();
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(encode(${guardianAddress}::bytea, 'hex'), 0))`);
    return queryRows<ClaimRow>(tx, sql`
    with eligible as (
      select
        t.id as trigger_id,
        t.action_kind,
        t.requested_assets,
        t.idempotency_key,
        a.id as assessment_id,
        c.id as account_id,
        c.address as account_address,
        c.code_hash as account_code_hash,
        p.id as policy_id,
        p.policy_nonce,
        p.policy_hash,
        p.market_id
      from automation_triggers t
      join risk_assessments a on a.id = t.assessment_id
      join policies p on p.id = t.policy_id and p.id = a.policy_id
      join crest_accounts c on c.id = a.crest_account_id and c.id = p.crest_account_id
      join networks n on n.chain_id = c.chain_id
      join account_snapshots s on s.id = a.account_snapshot_id
      where t.id = ${input.triggerId}
        and t.status = 'detected'
        and a.invalidated_at is null
        and p.status = 'active'
        and p.invalidated_at is null
        and p.policy_hash is not null
        and c.status = 'active'
        and c.chain_id = ${input.chainId}
        and c.address = ${accountAddress}
        and c.indexed_policy_nonce = p.policy_nonce
        and n.enabled
        and s.canonical
        and s.reorged_at is null
        and s.crest_account_id = c.id
        and s.guardian_address = ${guardianAddress}
        and s.policy_nonce = p.policy_nonce
        and s.market_id = p.market_id
        and s.vault_deployment_id = p.vault_deployment_id
        and a.recommended_action = t.action_kind
        and not exists (select 1 from automation_runs r where r.trigger_id = t.id)
        and not exists (
          select 1 from automation_runs unresolved
          where unresolved.guardian_address = ${guardianAddress} and unresolved.status = 'reorg_conflict'
        )
      for update of t
    ), inserted as (
      insert into automation_runs (trigger_id, status, guardian_address, selector, observed_policy_nonce, retry_count, started_at)
      select trigger_id, 'claimed', ${guardianAddress},
        case action_kind
          when 'freeze' then 'freezeBorrowing()'
          when 'repay_reserve' then 'repayFromReserve(uint256)'
          when 'repay_strategy' then 'repayFromStrategy(uint256)'
        end,
        policy_nonce, 0, ${recordedAt}
      from eligible
      on conflict (guardian_address) where status in ('claimed', 'signed', 'broadcast') do nothing
      returning id, trigger_id
    ), claimed as (
      update automation_triggers t
      set status = 'claimed', claimed_at = ${recordedAt}, lease_expires_at = null
      from eligible e
      join inserted r on r.trigger_id = e.trigger_id
      where t.id = e.trigger_id and t.status = 'detected'
      returning e.*
    )
    select r.id, c.trigger_id as "triggerId", c.action_kind as "actionKind",
      c.requested_assets as "requestedAssets", c.account_code_hash as "accountCodeHash",
      c.account_id as "accountId", c.account_address as "accountAddress", c.policy_id as "policyId",
      c.policy_nonce as "policyNonce", c.market_id as "marketId", c.policy_hash as "policyHash",
      c.assessment_id as "assessmentId", c.idempotency_key as "idempotencyKey"
    from inserted r
    join claimed c on c.trigger_id = r.trigger_id
    `);
  });
  if (rows.length > 1) throw new Error("guardian claim returned multiple runs");
  const row = rows[0];
  if (!row) return null;
  return {
    runId: row.id,
    triggerId: row.triggerId,
    actionKind: actionKind(row.actionKind),
    requestedAssets: numeric(row.requestedAssets),
    accountId: row.accountId,
    accountAddress: hex(row.accountAddress),
    accountCodeHash: hex(row.accountCodeHash),
    policyId: row.policyId,
    policyNonce: bigint(row.policyNonce),
    policyHash: hex(row.policyHash),
    marketId: hex(row.marketId),
    assessmentId: row.assessmentId,
    idempotencyKey: hex(row.idempotencyKey),
  };
}

export async function closeGuardianClaim(
  db: GuardianDatabase,
  input: { runId: string; status: "failed" | "superseded"; reason: string; now: Date },
): Promise<void> {
  const recordedAt = input.now.toISOString();
  await db.transaction(async (tx) => {
    const runs = await queryRows<{ status: string; failureClass: string | null }>(tx, sql`
      select status, failure_class as "failureClass" from automation_runs where id = ${input.runId} for update
    `);
    const run = one("guardian run not found", runs);
    const attempts = await queryRows<{ id: string }>(tx, sql`
      select id from transaction_attempts where run_id = ${input.runId} for update
    `);
    if (attempts.length > 0) throw new Error("signed attempt exists; refusing to close guardian claim");
    if (run.status !== "claimed") {
      if (run.status === input.status && run.failureClass === input.reason) return;
      throw new Error("guardian claim is not open");
    }
    await tx.execute(sql`
      update automation_runs set status = ${input.status}, failure_class = ${input.reason}, finished_at = ${recordedAt}
      where id = ${input.runId} and status = 'claimed'
    `);
    await tx.execute(sql`
      update automation_triggers set status = ${input.status}, completed_at = ${recordedAt}
      where id = (select trigger_id from automation_runs where id = ${input.runId}) and status = 'claimed'
    `);
  });
}

export async function recordGuardianAttempt(
  db: GuardianDatabase,
  input: GuardianAttemptInput,
): Promise<string> {
  const from = bytea(input.from, 20);
  const to = bytea(input.to, 20);
  const calldataHash = bytea(input.calldataHash, 32);
  const simulationBlockHash = bytea(input.simulationBlockHash, 32);
  const transactionHash = bytea(input.transactionHash, 32);
  const action = actionKindForSelector(input.selector);

  return db.transaction(async (tx) => {
    const inserted = await queryRows<{ id: string }>(tx, sql`
      with run as (
        select r.id
        from automation_runs r
        join automation_triggers t on t.id = r.trigger_id
        join risk_assessments a on a.id = t.assessment_id
        join policies p on p.id = t.policy_id and p.id = a.policy_id
        join account_snapshots s on s.id = a.account_snapshot_id
        join crest_accounts c on c.id = ${input.accountId} and c.id = a.crest_account_id and c.id = p.crest_account_id
        where r.id = ${input.runId}
          and r.status in ('claimed', 'signed', 'broadcast')
          and r.guardian_address = ${from}
          and c.chain_id = ${input.chainId}
          and c.address = ${to}
          and t.action_kind = ${action}
          and t.status = 'claimed'
          and a.invalidated_at is null
          and p.status = 'active' and p.invalidated_at is null
          and c.status = 'active' and c.indexed_policy_nonce = p.policy_nonce
          and r.observed_policy_nonce = p.policy_nonce
          and s.canonical and s.reorged_at is null and s.crest_account_id = c.id
          and s.guardian_address = ${from} and s.policy_nonce = p.policy_nonce
          and s.market_id = p.market_id and s.vault_deployment_id = p.vault_deployment_id
          and a.recommended_action = t.action_kind
        for update of r
      )
      insert into transaction_attempts
        (run_id, attempt_number, chain_id, crest_account_id, from_address, to_address, calldata_hash, decoded_operation,
         simulation_block_number, simulation_block_hash, simulation_success, simulation_gas, nonce, transaction_hash, submission_status)
      select id, 1, ${input.chainId}, ${input.accountId}, ${from}, ${to}, ${calldataHash}, ${input.selector},
             ${input.simulationBlockNumber}, ${simulationBlockHash}, true, ${input.simulationGas}, ${input.nonce}, ${transactionHash}, 'signed'
      from run
      on conflict (run_id, attempt_number) do nothing
      returning id
    `);
    if (inserted.length === 1) {
      await tx.execute(sql`update automation_runs set status = 'signed' where id = ${input.runId} and status = 'claimed'`);
      return inserted[0]!.id;
    }

    const attempts = await queryRows<AttemptRow>(tx, sql`
      select id, chain_id as "chainId", crest_account_id as "accountId", from_address as "from", to_address as "to",
        calldata_hash as "calldataHash", decoded_operation as selector, simulation_block_number as "simulationBlockNumber",
        simulation_block_hash as "simulationBlockHash", simulation_gas as "simulationGas", nonce, transaction_hash as "transactionHash"
      from transaction_attempts where run_id = ${input.runId} and attempt_number = 1 for update
    `);
    const attempt = attempts[0];
    if (!attempt) throw new Error("guardian run cannot accept an attempt");
    if (!sameAttempt(attempt, input)) throw new Error("signed attempt evidence changed");
    return attempt.id;
  });
}

export async function markGuardianBroadcast(db: GuardianDatabase, attemptId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await queryRows<{ submissionStatus: string }>(tx, sql`
      select submission_status as "submissionStatus" from transaction_attempts where id = ${attemptId} for update
    `);
    const attempt = one("guardian attempt not found", rows);
    if (attempt.submissionStatus === "broadcast") return;
    if (attempt.submissionStatus !== "signed") throw new Error("guardian attempt is not awaiting broadcast");
    await tx.execute(sql`update transaction_attempts set submission_status = 'broadcast', submitted_at = now() where id = ${attemptId}`);
    await tx.execute(sql`
      update automation_runs set status = 'broadcast'
      where id = (select run_id from transaction_attempts where id = ${attemptId}) and status = 'signed'
    `);
  });
}

export async function loadGuardianRecordedReceipt(
  db: GuardianDatabase,
  runId: string,
): Promise<{
  attemptId: string;
  transactionHash: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  canonical: boolean;
  accountAddress: `0x${string}`;
  guardianAddress: `0x${string}`;
  status: string;
} | null> {
  const rows = await queryRows<RecordedReceiptRow>(db, sql`
    select receipt.attempt_id as "attemptId", attempt.transaction_hash as "transactionHash",
      receipt.block_number as "blockNumber", receipt.block_hash as "blockHash", receipt.canonical,
      attempt.to_address as "accountAddress", attempt.from_address as "guardianAddress", run.status
    from transaction_receipts receipt
    join transaction_attempts attempt on attempt.id = receipt.attempt_id
    join automation_runs run on run.id = attempt.run_id
    where attempt.run_id = ${runId}
    order by receipt.canonical desc, receipt.observed_at desc, receipt.id desc
    limit 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    attemptId: row.attemptId,
    transactionHash: hex(row.transactionHash),
    blockNumber: bigint(row.blockNumber),
    blockHash: hex(row.blockHash),
    canonical: row.canonical,
    accountAddress: hex(row.accountAddress),
    guardianAddress: hex(row.guardianAddress),
    status: row.status,
  };
}

export async function markGuardianReceiptReorged(
  db: GuardianDatabase,
  runId: string,
  attemptId: string,
  blockHash: `0x${string}`,
  now: Date,
): Promise<"relocked" | "conflict"> {
  const receiptBlockHash = bytea(blockHash, 32);
  const recordedAt = now.toISOString();
  return db.transaction(async (tx) => {
    const [signer] = await queryRows<{ address: Uint8Array }>(tx, sql`
      select guardian_address as address from automation_runs where id = ${runId}
    `);
    if (!signer) throw new Error("guardian run not found");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(encode(${signer.address}::bytea, 'hex'), 0))`);
    const run = one("guardian run not found", await queryRows<{ triggerId: string; status: string }>(tx, sql`
      select trigger_id as "triggerId", status from automation_runs where id = ${runId} for update
    `));
    const attempt = one("guardian attempt not found", await queryRows<{ submissionStatus: string }>(tx, sql`
      select submission_status as "submissionStatus"
      from transaction_attempts where id = ${attemptId} and run_id = ${runId} for update
    `));
    if (attempt.submissionStatus !== "signed" && attempt.submissionStatus !== "broadcast") {
      throw new Error("guardian attempt cannot be reopened");
    }
    const receipt = one("guardian canonical receipt not found", await queryRows<ReorgReceiptRow>(tx, sql`
      select canonical, reorged_at as "reorgedAt"
      from transaction_receipts
      where attempt_id = ${attemptId} and block_hash = ${receiptBlockHash}
      for update
    `));
    if (!receipt.canonical) {
      if (receipt.reorgedAt !== null) return run.status === "reorg_conflict" ? "conflict" : "relocked";
      throw new Error("guardian receipt is not canonical");
    }
    const occupied = await queryRows<{ id: string }>(tx, sql`
      select id from automation_runs
      where guardian_address = ${signer.address} and id <> ${runId}
        and status in ('claimed', 'signed', 'broadcast')
      limit 1
    `);
    await tx.execute(sql`
      update transaction_receipts
      set canonical = false, reorged_at = ${recordedAt}
      where attempt_id = ${attemptId} and block_hash = ${receiptBlockHash} and canonical
    `);
    await tx.execute(sql`
      update automation_runs
      set status = ${occupied.length > 0 ? "reorg_conflict" : attempt.submissionStatus},
        failure_class = ${occupied.length > 0 ? "receipt_reorg_signer_conflict" : null}, finished_at = null
      where id = ${runId}
    `);
    await tx.execute(sql`
      update automation_triggers
      set status = 'claimed', completed_at = null
      where id = ${run.triggerId}
    `);
    return occupied.length > 0 ? "conflict" : "relocked";
  });
}

export async function loadGuardianPendingAttempt(
  db: GuardianDatabase,
  runId: string,
): Promise<{
  attemptId: string;
  transactionHash: `0x${string}`;
  runId: string;
  simulationBlockNumber: bigint;
  simulationBlockHash: `0x${string}`;
  calldataHash: `0x${string}`;
  actionKind: GuardianActionKind;
  requestedAssets: bigint | null;
  accountId: string;
  accountAddress: `0x${string}`;
  guardianAddress: `0x${string}`;
  policyNonce: bigint;
} | null> {
  const rows = await queryRows<PendingAttemptRow>(db, sql`
    select a.id as "attemptId", a.transaction_hash as "transactionHash", a.calldata_hash as "calldataHash", r.id as "runId",
      a.simulation_block_number as "simulationBlockNumber", a.simulation_block_hash as "simulationBlockHash", t.action_kind as "actionKind",
      t.requested_assets as "requestedAssets", a.crest_account_id as "accountId", c.address as "accountAddress",
      r.guardian_address as "guardianAddress", r.observed_policy_nonce as "policyNonce"
    from transaction_attempts a
    join automation_runs r on r.id = a.run_id
    join automation_triggers t on t.id = r.trigger_id
    join crest_accounts c on c.id = a.crest_account_id
    left join transaction_receipts receipt on receipt.attempt_id = a.id and receipt.canonical
    where r.id = ${runId}
      and a.submission_status in ('signed', 'broadcast')
      and a.transaction_hash is not null
      and receipt.id is null
  `);
  if (rows.length > 1) throw new Error("guardian run has multiple pending attempts");
  const row = rows[0];
  if (!row) return null;
  return {
    attemptId: row.attemptId,
    transactionHash: hex(row.transactionHash),
    calldataHash: hex(row.calldataHash),
    runId: row.runId,
    simulationBlockNumber: bigint(row.simulationBlockNumber),
    simulationBlockHash: hex(row.simulationBlockHash),
    actionKind: actionKind(row.actionKind),
    requestedAssets: numeric(row.requestedAssets),
    accountId: row.accountId,
    accountAddress: hex(row.accountAddress),
    guardianAddress: hex(row.guardianAddress),
    policyNonce: bigint(row.policyNonce),
  };
}

export async function recordGuardianReconciliation(
  db: GuardianDatabase,
  input: {
    runId: string;
    attemptId: string;
    receipt: { blockNumber: bigint; blockHash: `0x${string}`; canonical: boolean; success: boolean; gasUsed: bigint; decodedEvents: unknown };
    checks: Array<{ kind: PostconditionKind; passed: boolean; expectedJson: unknown; actualJson: unknown }>;
    checkedBlock: { number: bigint; hash: `0x${string}` };
    now: Date;
  },
): Promise<void> {
  const receiptBlockHash = bytea(input.receipt.blockHash, 32);
  const checkedBlockHash = bytea(input.checkedBlock.hash, 32);
  const recordedAt = input.now.toISOString();
  assertChecks(input.checks);

  await db.transaction(async (tx) => {
    const runs = await queryRows<{ actionKind: string }>(tx, sql`
      select t.action_kind as "actionKind"
      from automation_runs r join automation_triggers t on t.id = r.trigger_id
      where r.id = ${input.runId} for update of r
    `);
    const run = one("guardian run not found", runs);
    const attempts = await queryRows<{ runId: string }>(tx, sql`
      select run_id as "runId" from transaction_attempts where id = ${input.attemptId} for update
    `);
    const attempt = one("guardian attempt not found", attempts);
    if (attempt.runId !== input.runId) throw new Error("guardian attempt belongs to another run");

    const canonicalReceipts = await queryRows<ReceiptRow>(tx, sql`
      select block_number as "blockNumber", block_hash as "blockHash", canonical, success, gas_used as "gasUsed", decoded_events as "decodedEvents"
      from transaction_receipts where attempt_id = ${input.attemptId} and canonical for update
    `);
    if (canonicalReceipts.length > 1) throw new Error("guardian attempt has multiple canonical receipts");
    const canonicalReceipt = canonicalReceipts[0];
    if (canonicalReceipt && hex(canonicalReceipt.blockHash) !== input.receipt.blockHash.toLowerCase()) {
      throw new Error("canonical Guardian receipt exists at another block");
    }

    const insertedReceipt = await queryRows<ReceiptRow>(tx, sql`
      insert into transaction_receipts
        (attempt_id, block_number, block_hash, canonical, success, gas_used, decoded_events, observed_at)
      values (${input.attemptId}, ${input.receipt.blockNumber}, ${receiptBlockHash}, ${input.receipt.canonical}, ${input.receipt.success}, ${input.receipt.gasUsed}, ${JSON.stringify(input.receipt.decodedEvents)}::jsonb, ${recordedAt})
      on conflict (attempt_id, block_hash) do nothing
      returning block_number as "blockNumber", block_hash as "blockHash", canonical, success, gas_used as "gasUsed", decoded_events as "decodedEvents"
    `);
    const receipt = insertedReceipt[0] ?? one("guardian receipt not found", await queryRows<ReceiptRow>(tx, sql`
      select block_number as "blockNumber", block_hash as "blockHash", canonical, success, gas_used as "gasUsed", decoded_events as "decodedEvents"
      from transaction_receipts where attempt_id = ${input.attemptId} and block_hash = ${receiptBlockHash} for update
    `));
    if (!sameReceipt(receipt, input.receipt)) throw new Error("receipt evidence changed on replay");

    for (const check of input.checks) {
      await tx.execute(sql`
        insert into postcondition_checks (run_id, kind, passed, expected_json, actual_json, checked_block_number, checked_block_hash, checked_at)
        values (${input.runId}, ${check.kind}, ${check.passed}, ${JSON.stringify(check.expectedJson)}::jsonb, ${JSON.stringify(check.actualJson)}::jsonb, ${input.checkedBlock.number}, ${checkedBlockHash}, ${recordedAt})
        on conflict (run_id, kind, checked_block_hash) do nothing
      `);
      const saved = one("guardian postcondition not found", await queryRows<CheckRow>(tx, sql`
        select kind, passed, expected_json as "expectedJson", actual_json as "actualJson", checked_block_number as "checkedBlockNumber", checked_block_hash as "checkedBlockHash"
        from postcondition_checks
        where run_id = ${input.runId} and kind = ${check.kind} and checked_block_hash = ${checkedBlockHash}
        for update
      `));
      if (!sameCheck(saved, check, input.checkedBlock)) throw new Error("postcondition evidence changed on replay");
    }

    const passed = new Set(input.checks.filter((check) => check.passed).map((check) => check.kind));
    const completed = input.receipt.canonical && input.receipt.success && requiredChecks(actionKind(run.actionKind)).every((kind) => passed.has(kind));
    await tx.execute(sql`
      update automation_runs set status = ${completed ? "completed" : "failed"},
        failure_class = ${completed ? null : "receipt_or_postcondition_failed"}, finished_at = ${recordedAt}
      where id = ${input.runId} and status not in ('completed', 'failed', 'superseded')
    `);
    await tx.execute(sql`
      update automation_triggers set status = ${completed ? "completed" : "failed"}, completed_at = ${recordedAt}
      where id = (select trigger_id from automation_runs where id = ${input.runId})
        and status not in ('completed', 'failed', 'superseded')
    `);
  });
}

interface ClaimRow {
  id: string;
  triggerId: string;
  actionKind: string;
  requestedAssets: string | bigint | null;
  accountId: string;
  accountAddress: Uint8Array;
  accountCodeHash: Uint8Array;
  policyId: string;
  policyNonce: string | bigint;
  policyHash: Uint8Array;
  marketId: Uint8Array;
  assessmentId: string;
  idempotencyKey: Uint8Array;
}

interface AttemptRow {
  id: string;
  chainId: string | bigint;
  accountId: string;
  from: Uint8Array;
  to: Uint8Array;
  calldataHash: Uint8Array;
  selector: string;
  simulationBlockNumber: string | bigint;
  simulationBlockHash: Uint8Array | null;
  simulationGas: string | bigint | null;
  nonce: string | bigint | null;
  transactionHash: Uint8Array | null;
}

interface PendingAttemptRow {
  attemptId: string;
  transactionHash: Uint8Array;
  calldataHash: Uint8Array;
  runId: string;
  actionKind: string;
  requestedAssets: string | bigint | null;
  simulationBlockNumber: string | bigint;
  simulationBlockHash: Uint8Array;
  accountId: string;
  accountAddress: Uint8Array;
  guardianAddress: Uint8Array;
  policyNonce: string | bigint;
}

interface RecordedReceiptRow {
  attemptId: string;
  transactionHash: Uint8Array;
  blockNumber: string | bigint;
  blockHash: Uint8Array;
  canonical: boolean;
  accountAddress: Uint8Array;
  guardianAddress: Uint8Array;
  status: string;
}

interface ReorgReceiptRow {
  canonical: boolean;
  reorgedAt: Date | string | null;
}

interface ReceiptRow {
  blockNumber: string | bigint;
  blockHash: Uint8Array;
  canonical: boolean;
  success: boolean;
  gasUsed: string | bigint;
  decodedEvents: unknown;
}

interface CheckRow {
  kind: string;
  passed: boolean;
  expectedJson: unknown;
  actualJson: unknown;
  checkedBlockNumber: string | bigint;
  checkedBlockHash: Uint8Array;
}

function actionKind(value: string): GuardianActionKind {
  if (value === "freeze" || value === "repay_reserve" || value === "repay_strategy") return value;
  throw new Error("invalid Guardian action kind");
}

function actionKindForSelector(selector: GuardianSelector): GuardianActionKind {
  if (selector === "freezeBorrowing()") return "freeze";
  if (selector === "repayFromReserve(uint256)") return "repay_reserve";
  if (selector === "repayFromStrategy(uint256)") return "repay_strategy";
  throw new Error("invalid Guardian selector");
}

function requiredChecks(kind: GuardianActionKind): readonly PostconditionKind[] {
  if (kind === "freeze") return ["frozen"];
  if (kind === "repay_reserve") return ["debt_decreased", "reserve_floor_held", "repay_beneficiary_fixed"];
  return ["debt_decreased", "strategy_floor_held", "vault_receiver_fixed", "repay_beneficiary_fixed"];
}

function assertChecks(checks: readonly { kind: PostconditionKind }[]): void {
  const seen = new Set<PostconditionKind>();
  for (const check of checks) {
    if (!requiredChecks("freeze").includes(check.kind) && !requiredChecks("repay_reserve").includes(check.kind) && !requiredChecks("repay_strategy").includes(check.kind)) {
      throw new Error("invalid Guardian postcondition kind");
    }
    if (seen.has(check.kind)) throw new Error("duplicate Guardian postcondition kind");
    seen.add(check.kind);
  }
}

function sameAttempt(row: AttemptRow, input: GuardianAttemptInput): boolean {
  return bigint(row.chainId) === input.chainId
    && row.accountId === input.accountId
    && hex(row.from) === input.from.toLowerCase()
    && hex(row.to) === input.to.toLowerCase()
    && hex(row.calldataHash) === input.calldataHash.toLowerCase()
    && row.selector === input.selector
    && bigint(row.simulationBlockNumber) === input.simulationBlockNumber
    && hex(row.simulationBlockHash) === input.simulationBlockHash.toLowerCase()
    && numeric(row.simulationGas) === input.simulationGas
    && numeric(row.nonce) === input.nonce
    && hex(row.transactionHash) === input.transactionHash.toLowerCase();
}

function sameReceipt(row: ReceiptRow, input: { blockNumber: bigint; blockHash: `0x${string}`; canonical: boolean; success: boolean; gasUsed: bigint; decodedEvents: unknown }): boolean {
  return bigint(row.blockNumber) === input.blockNumber
    && hex(row.blockHash) === input.blockHash.toLowerCase()
    && row.canonical === input.canonical
    && row.success === input.success
    && bigint(row.gasUsed) === input.gasUsed
    && canonicalJson(row.decodedEvents) === canonicalJson(input.decodedEvents);
}

function sameCheck(row: CheckRow, check: { kind: PostconditionKind; passed: boolean; expectedJson: unknown; actualJson: unknown }, checkedBlock: { number: bigint; hash: `0x${string}` }): boolean {
  return row.kind === check.kind
    && row.passed === check.passed
    && canonicalJson(row.expectedJson) === canonicalJson(check.expectedJson)
    && canonicalJson(row.actualJson) === canonicalJson(check.actualJson)
    && bigint(row.checkedBlockNumber) === checkedBlock.number
    && hex(row.checkedBlockHash) === checkedBlock.hash.toLowerCase();
}

function bytea(value: `0x${string}`, size: number): Uint8Array {
  if (!new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)) throw new Error(`expected ${size}-byte hex value`);
  return Buffer.from(value.slice(2), "hex");
}

function bigint(value: string | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function numeric(value: string | bigint | null): bigint | null {
  return value === null ? null : bigint(value);
}

function hex(value: Uint8Array | null): `0x${string}` {
  if (!value) throw new Error("missing binary Guardian evidence");
  return `0x${Buffer.from(value).toString("hex")}` as `0x${string}`;
}

async function queryRows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = await executor.execute(query) as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : result.rows ?? [];
}

function one<T>(message: string, rows: T[]): T {
  if (rows.length !== 1) throw new Error(message);
  return rows[0]!;
}
