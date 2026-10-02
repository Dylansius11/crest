import { sql, type SQL } from "drizzle-orm";
import { getAddress, isAddress } from "viem";

import type { DeploymentManifest } from "@crest/contracts/manifest";

export interface RecordedAccount {
  address: string;
  chainId: string;
  codeHash: string;
  policyNonce: string;
  status: string;
}

export interface AccountRegistryResponse {
  evidence: "recorded";
  accounts: RecordedAccount[];
}

export interface AccountSnapshot {
  blockNumber: string;
  blockHash: string;
  observedAt: string;
  owner: string;
  guardian: string;
  frozen: boolean;
  collateralAssets: string | null;
  debtAssets: string | null;
  collateralValueAssets: string | null;
  ltvWad: string | null;
  morphoHealthWad: string | null;
  lowerLtvWad: string;
  targetLtvWad: string;
  upperLtvWad: string;
  criticalLtvWad: string;
  reserveAssets: string | null;
  vaultShares: string | null;
  quotedVaultAssets: string | null;
  withdrawableVaultAssets: string | null;
  reserveFloorAssets: string;
  strategyFloorAssets: string;
  maxRepayPerActionAssets: string;
}

/** One rate exactly as the assessment consumed it; an unread rate keeps its status and reasons, never a default. */
export interface RecordedRate {
  status: string;
  reasons: string[];
  value: string | null;
  scale: string | null;
  convention: string | null;
  window: string | null;
  source: string | null;
  observedAt: string | null;
}

/** One assessment input exactly as recorded: its status, reasons, and where and when it was read. */
export interface RecordedInput {
  input: string;
  status: string;
  reasons: string[];
  source: string | null;
  blockNumber: string | null;
  observedAt: string | null;
}

export interface AccountAssessment {
  status: string;
  createdAt: string;
  reasonCodes: string[];
  recommendedAction: string;
  policyHealthWad: string | null;
  ownerBorrowCapacityAssets: string | null;
  repayCapacityAssets: string | null;
  projectedCarryAssets: string | null;
  projectedSpreadBps: string | null;
  rates: { borrow: RecordedRate; vault: RecordedRate };
  provenance: RecordedInput[];
}

/** The account's most recent Guardian trigger, its latest run, and that run's postcondition checks. */
export interface RecordedIntervention {
  actionKind: string;
  requestedAssets: string | null;
  status: string;
  reasonCodes: string[];
  detectedAt: string;
  forCurrentAssessment: boolean;
  run: {
    status: string;
    failureClass: string | null;
    transactionHash: string | null;
    checks: { kind: string; passed: boolean }[];
  } | null;
}

/** The most recent canonical debt reduction paid from the fixed strategy. */
export interface RecordedRepayment {
  debtBeforeAssets: string;
  debtAfterAssets: string;
  debtRepaidAssets: string;
  blockNumber: string;
  transactionHash: string;
}

export interface AccountPositionResponse {
  evidence: "recorded";
  account: RecordedAccount;
  snapshot: AccountSnapshot | null;
  assessment: AccountAssessment | null;
  realizedDebtRepaidAssets: string | null;
  latestRepayment: RecordedRepayment | null;
  latestIntervention: RecordedIntervention | null;
}

/** Injectable boundary for deterministic route tests. Values are always recorded database evidence. */
export interface RecordedAccountReader {
  listByOwner(owner: string): Promise<RecordedAccount[]>;
  positionByAddress(address: string): Promise<AccountPositionResponse | null>;
}

export interface RecordedAccountDatabase {
  execute(query: SQL): Promise<unknown>;
}

type AccountRow = {
  address: string;
  chainId: string | bigint;
  codeHash: string;
  policyNonce: string | bigint;
  status: string;
};

type PositionRow = AccountRow & {
  snapshotBlockNumber: string | bigint | null;
  snapshotBlockHash: string | null;
  snapshotObservedAt: Date | string | null;
  snapshotOwner: string | null;
  snapshotGuardian: string | null;
  snapshotFrozen: boolean | null;
  collateralAssets: string | bigint | null;
  debtAssets: string | bigint | null;
  collateralValueAssets: string | bigint | null;
  ltvWad: string | bigint | null;
  morphoHealthWad: string | bigint | null;
  lowerLtvWad: string | bigint | null;
  targetLtvWad: string | bigint | null;
  upperLtvWad: string | bigint | null;
  criticalLtvWad: string | bigint | null;
  reserveAssets: string | bigint | null;
  vaultShares: string | bigint | null;
  quotedVaultAssets: string | bigint | null;
  withdrawableVaultAssets: string | bigint | null;
  reserveFloorAssets: string | bigint | null;
  strategyFloorAssets: string | bigint | null;
  maxRepayPerActionAssets: string | bigint | null;
  assessmentStatus: string | null;
  assessmentCreatedAt: Date | string | null;
  assessmentReasonCodes: string[] | null;
  assessmentRecommendedAction: string | null;
  assessmentInput: unknown;
  policyHealthWad: string | bigint | null;
  ownerBorrowCapacityAssets: string | bigint | null;
  repayCapacityAssets: string | bigint | null;
  projectedCarryAssets: string | bigint | null;
  projectedSpreadBps: string | bigint | null;
  realizedDebtRepaidAssets: string | bigint | null;
  repaymentDebtBefore: string | bigint | null;
  repaymentDebtAfter: string | bigint | null;
  repaymentRepaid: string | bigint | null;
  repaymentBlockNumber: string | bigint | null;
  repaymentTransactionHash: string | null;
  interventionActionKind: string | null;
  interventionRequestedAssets: string | bigint | null;
  interventionStatus: string | null;
  interventionReasonCodes: string[] | null;
  interventionDetectedAt: Date | string | null;
  interventionForCurrentAssessment: boolean | null;
  runStatus: string | null;
  runFailureClass: string | null;
  runTransactionHash: string | null;
  runChecks: unknown;
};

/** Reads only canonical same-block observations from the reviewed route. */
export function createRecordedAccountReader(
  db: RecordedAccountDatabase,
  manifest: DeploymentManifest,
): RecordedAccountReader {
  const chainId = BigInt(manifest.network.chainId);
  const marketId = hexBytes(manifest.market.id);
  const vaultAddress = hexBytes(manifest.vault.address);

  return {
    async listByOwner(owner) {
      const rows = await queryRows<AccountRow>(db, sql`
        select
          encode(c.address, 'hex') as address,
          c.chain_id as "chainId",
          encode(c.code_hash, 'hex') as "codeHash",
          c.indexed_policy_nonce as "policyNonce",
          c.status
        from crest_accounts c
        join owners o on o.id = c.owner_id
        where c.chain_id = ${chainId.toString()}
          and o.address = decode(${hexBytes(owner)}, 'hex')
        order by c.deployment_block_number desc, c.address
      `);
      return rows.map(toAccount);
    },

    async positionByAddress(address) {
      const rows = await queryRows<PositionRow>(db, sql`
        with account as (
          select
            c.id,
            encode(c.address, 'hex') as address,
            c.chain_id as "chainId",
            encode(c.code_hash, 'hex') as "codeHash",
            c.indexed_policy_nonce as "policyNonce",
            c.status
          from crest_accounts c
          where c.chain_id = ${chainId.toString()}
            and c.address = decode(${hexBytes(address)}, 'hex')
        ), coherent_snapshot as (
          select
            a.id as account_snapshot_id,
            p.id as position_snapshot_id,
            s.id as strategy_snapshot_id,
            a.vault_deployment_id,
            a.block_number as block_number,
            encode(a.block_hash, 'hex') as block_hash,
            a.observed_at,
            encode(a.owner_address, 'hex') as owner,
            encode(a.guardian_address, 'hex') as guardian,
            a.borrowing_frozen,
            p.collateral_assets,
            p.borrow_assets_up,
            p.collateral_value,
            p.ltv_wad,
            p.morpho_health_wad,
            a.lower_ltv_wad,
            a.target_ltv_wad,
            a.upper_ltv_wad,
            a.critical_ltv_wad,
            a.loan_token_balance,
            s.share_balance,
            s.quoted_assets,
            s.max_withdrawable_assets,
            a.reserve_floor_assets,
            a.strategy_floor_assets,
            a.max_repay_per_action_assets
          from account c
          join account_snapshots a on a.crest_account_id = c.id
          join position_snapshots p on p.crest_account_id = c.id
            and p.market_id = a.market_id
            and p.block_number = a.block_number
            and p.block_hash = a.block_hash
            and p.canonical
          join strategy_position_snapshots s on s.crest_account_id = c.id
            and s.vault_deployment_id = a.vault_deployment_id
            and s.block_number = a.block_number
            and s.block_hash = a.block_hash
            and s.canonical
          join vault_deployments v on v.id = a.vault_deployment_id
            and v.chain_id = c."chainId"
            and v.address = decode(${vaultAddress}, 'hex')
          where a.canonical
            and a.market_id = decode(${marketId}, 'hex')
            and a.policy_nonce = c."policyNonce"
          order by a.block_number desc, a.observed_at desc
          limit 1
        )
        select
          c.address,
          c."chainId",
          c."codeHash",
          c."policyNonce",
          c.status,
          s.block_number as "snapshotBlockNumber",
          s.block_hash as "snapshotBlockHash",
          s.observed_at as "snapshotObservedAt",
          s.owner as "snapshotOwner",
          s.guardian as "snapshotGuardian",
          s.borrowing_frozen as "snapshotFrozen",
          s.collateral_assets as "collateralAssets",
          s.borrow_assets_up as "debtAssets",
          s.loan_token_balance as "reserveAssets",
          s.collateral_value as "collateralValueAssets",
          s.ltv_wad as "ltvWad",
          s.morpho_health_wad as "morphoHealthWad",
          s.lower_ltv_wad as "lowerLtvWad",
          s.target_ltv_wad as "targetLtvWad",
          s.upper_ltv_wad as "upperLtvWad",
          s.critical_ltv_wad as "criticalLtvWad",
          s.share_balance as "vaultShares",
          s.quoted_assets as "quotedVaultAssets",
          s.max_withdrawable_assets as "withdrawableVaultAssets",
          s.reserve_floor_assets as "reserveFloorAssets",
          s.strategy_floor_assets as "strategyFloorAssets",
          s.max_repay_per_action_assets as "maxRepayPerActionAssets",
          assessment.status as "assessmentStatus",
          assessment.created_at as "assessmentCreatedAt",
          assessment.reason_codes as "assessmentReasonCodes",
          assessment.recommended_action as "assessmentRecommendedAction",
          assessment.input_json as "assessmentInput",
          assessment.policy_health_wad as "policyHealthWad",
          assessment.owner_borrow_capacity_assets as "ownerBorrowCapacityAssets",
          assessment.repay_capacity_assets as "repayCapacityAssets",
          assessment.estimated_annual_carry_assets as "projectedCarryAssets",
          assessment.estimated_spread_bps as "projectedSpreadBps",
          realized.debt_repaid_assets as "realizedDebtRepaidAssets",
          latest.debt_before_assets as "repaymentDebtBefore",
          latest.debt_after_assets as "repaymentDebtAfter",
          latest.debt_repaid_assets as "repaymentRepaid",
          latest.block_number as "repaymentBlockNumber",
          encode(latest.transaction_hash, 'hex') as "repaymentTransactionHash",
          intervention.action_kind as "interventionActionKind",
          intervention.requested_assets as "interventionRequestedAssets",
          intervention.status as "interventionStatus",
          intervention.reason_codes as "interventionReasonCodes",
          intervention.detected_at as "interventionDetectedAt",
          intervention.assessment_id = assessment.id as "interventionForCurrentAssessment",
          run.status as "runStatus",
          run.failure_class as "runFailureClass",
          run.transaction_hash as "runTransactionHash",
          run.checks as "runChecks"
        from account c
        left join coherent_snapshot s on true
        left join lateral (
          select a.*
          from risk_assessments a
          join policies p on p.id = a.policy_id
            and p.crest_account_id = c.id
            and p.status = 'active'
            and p.invalidated_at is null
            and p.policy_nonce = c."policyNonce"
            and p.market_id = decode(${marketId}, 'hex')
            and p.vault_deployment_id = s.vault_deployment_id
            and a.invalidated_at is null
            and a.account_snapshot_id = s.account_snapshot_id
            and a.position_snapshot_id = s.position_snapshot_id
            and a.strategy_position_snapshot_id = s.strategy_snapshot_id
          order by a.created_at desc
          limit 1
        ) assessment on true
        left join lateral (
          -- Only canonical debt reductions count; projections and non-repay strategy events never enter this total.
          select sum(e.debt_repaid_assets) as debt_repaid_assets
          from realized_strategy_events e
          where e.crest_account_id = c.id and e.kind = 'repay' and e.canonical
        ) realized on true
        left join lateral (
          select e.debt_before_assets, e.debt_after_assets, e.debt_repaid_assets, e.block_number, e.transaction_hash
          from realized_strategy_events e
          where e.crest_account_id = c.id and e.kind = 'repay' and e.canonical
          order by e.block_number desc, e.log_index desc
          limit 1
        ) latest on true
        left join lateral (
          select t.id, t.assessment_id, t.action_kind, t.requested_assets, t.status, t.reason_codes, t.detected_at
          from automation_triggers t
          join risk_assessments ra on ra.id = t.assessment_id and ra.crest_account_id = c.id
          order by t.detected_at desc
          limit 1
        ) intervention on true
        left join lateral (
          select r.status, r.failure_class,
            (select encode(x.transaction_hash, 'hex') from transaction_attempts x
              where x.run_id = r.id and x.transaction_hash is not null
              order by x.attempt_number desc limit 1) as transaction_hash,
            (select coalesce(json_agg(json_build_object('kind', k.kind, 'passed', k.passed) order by k.kind), '[]'::json)
              from postcondition_checks k where k.run_id = r.id) as checks
          from automation_runs r
          where r.trigger_id = intervention.id
          order by r.started_at desc
          limit 1
        ) run on true
      `);
      const row = rows[0];
      return row ? toPosition(row) : null;
    },
  };
}

/** Accepts exactly a lowercase or valid EIP-55 address and returns lowercase storage identity. */
export function parsePublicAddress(value: string): string | null {
  if (!isAddress(value, { strict: true })) return null;
  return getAddress(value).toLowerCase();
}

function toAccount(row: AccountRow): RecordedAccount {
  return {
    address: `0x${row.address}`,
    chainId: decimal(row.chainId),
    codeHash: `0x${row.codeHash}`,
    policyNonce: decimal(row.policyNonce),
    status: row.status,
  };
}

function toPosition(row: PositionRow): AccountPositionResponse {
  const snapshot = row.snapshotBlockNumber === null ? null : {
    blockNumber: decimal(row.snapshotBlockNumber),
    blockHash: `0x${required(row.snapshotBlockHash)}`,
    observedAt: timestamp(required(row.snapshotObservedAt)),
    owner: `0x${required(row.snapshotOwner)}`,
    guardian: `0x${required(row.snapshotGuardian)}`,
    frozen: required(row.snapshotFrozen),
    collateralAssets: nullableDecimal(row.collateralAssets),
    debtAssets: nullableDecimal(row.debtAssets),
    collateralValueAssets: nullableDecimal(row.collateralValueAssets),
    ltvWad: nullableDecimal(row.ltvWad),
    morphoHealthWad: nullableDecimal(row.morphoHealthWad),
    lowerLtvWad: decimal(required(row.lowerLtvWad)),
    targetLtvWad: decimal(required(row.targetLtvWad)),
    upperLtvWad: decimal(required(row.upperLtvWad)),
    criticalLtvWad: decimal(required(row.criticalLtvWad)),
    reserveAssets: nullableDecimal(row.reserveAssets),
    vaultShares: nullableDecimal(row.vaultShares),
    quotedVaultAssets: nullableDecimal(row.quotedVaultAssets),
    withdrawableVaultAssets: nullableDecimal(row.withdrawableVaultAssets),
    reserveFloorAssets: decimal(required(row.reserveFloorAssets)),
    strategyFloorAssets: decimal(required(row.strategyFloorAssets)),
    maxRepayPerActionAssets: decimal(required(row.maxRepayPerActionAssets)),
  };
  const input = typeof row.assessmentInput === "string" ? JSON.parse(row.assessmentInput) : row.assessmentInput;
  const rates = field(input, "rates");
  const assessment = row.assessmentStatus === null ? null : {
    createdAt: timestamp(required(row.assessmentCreatedAt)),
    status: row.assessmentStatus,
    reasonCodes: row.assessmentReasonCodes ?? [],
    recommendedAction: required(row.assessmentRecommendedAction),
    policyHealthWad: nullableDecimal(row.policyHealthWad),
    ownerBorrowCapacityAssets: nullableDecimal(row.ownerBorrowCapacityAssets),
    repayCapacityAssets: nullableDecimal(row.repayCapacityAssets),
    projectedCarryAssets: nullableDecimal(row.projectedCarryAssets),
    projectedSpreadBps: nullableDecimal(row.projectedSpreadBps),
    rates: { borrow: recordedRate(rates, "borrow"), vault: recordedRate(rates, "vault") },
    provenance: recordedInputs(input),
  };
  const latestRepayment = row.repaymentBlockNumber === null ? null : {
    debtBeforeAssets: decimal(required(row.repaymentDebtBefore)),
    debtAfterAssets: decimal(required(row.repaymentDebtAfter)),
    debtRepaidAssets: decimal(required(row.repaymentRepaid)),
    blockNumber: decimal(row.repaymentBlockNumber),
    transactionHash: `0x${required(row.repaymentTransactionHash)}`,
  };
  const latestIntervention = row.interventionActionKind === null ? null : {
    actionKind: row.interventionActionKind,
    requestedAssets: nullableDecimal(row.interventionRequestedAssets),
    status: required(row.interventionStatus),
    reasonCodes: row.interventionReasonCodes ?? [],
    detectedAt: timestamp(required(row.interventionDetectedAt)),
    forCurrentAssessment: row.interventionForCurrentAssessment === true,
    run: row.runStatus === null ? null : {
      status: row.runStatus,
      failureClass: row.runFailureClass,
      transactionHash: row.runTransactionHash === null ? null : `0x${row.runTransactionHash}`,
      checks: recordedChecks(row.runChecks),
    },
  };

  return {
    evidence: "recorded",
    account: toAccount(row),
    snapshot,
    assessment,
    realizedDebtRepaidAssets: nullableDecimal(row.realizedDebtRepaidAssets),
    latestRepayment,
    latestIntervention,
  };
}

const UNRECORDED_RATE: RecordedRate = {
  status: "unknown", reasons: ["not_recorded"], value: null, scale: null, convention: null, window: null, source: null, observedAt: null,
};

function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Canonical JSON stores bigints as `{ "$bigint": "<digits>" }`. */
function bigintText(value: unknown): string | null {
  const digits = field(value, "$bigint");
  return typeof digits === "string" && /^-?\d+$/.test(digits) ? digits : null;
}

/** Every observation the engine consumed, in screen order; lifecycle signals appear one per input. */
const INPUT_PATHS: readonly (readonly string[])[] = [
  ["head"], ["account"], ["market"], ["position"],
  ["oracle", "marketPrice"], ["oracle", "collateralFeed"], ["oracle", "loanFeed"],
  ["vault"], ["strategy"],
  ["rates", "borrow"], ["rates", "vault"], ["rates", "fees"], ["rates", "vaultIncentives"], ["rates", "marketIncentives"],
];

function at(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => field(node, key), value);
}

function reasonList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((reason): reason is string => typeof reason === "string") : [];
}

/** Source and time of one observation: an HTTP URL and fetch time, or an onchain block. */
function origin(observation: unknown) {
  const provenance = field(observation, "provenance");
  const block = field(provenance, "block");
  const blockNumber = bigintText(field(block, "number"));
  const blockTime = bigintText(field(block, "timestamp"));
  return {
    source: text(field(provenance, "url")) ?? (blockNumber === null ? null : `block ${blockNumber}`),
    blockNumber,
    observedAt: text(field(provenance, "fetchedAt")) ?? (blockTime === null ? null : new Date(Number(blockTime) * 1000).toISOString()),
  };
}

function recordedInputs(input: unknown): RecordedInput[] {
  const lifecycleInputs = field(field(input, "lifecycle"), "inputs");
  const lifecyclePaths = typeof lifecycleInputs === "object" && lifecycleInputs !== null
    ? Object.keys(lifecycleInputs).sort().map((key) => ["lifecycle", "inputs", key])
    : [];
  return [...INPUT_PATHS, ...lifecyclePaths].flatMap((path) => {
    const observation = at(input, path);
    const status = text(field(observation, "status"));
    if (status === null) return [];
    const { source, blockNumber, observedAt } = origin(observation);
    return [{ input: path.filter((key) => key !== "inputs").join("."), status, reasons: reasonList(field(observation, "reasons")), source, blockNumber, observedAt }];
  });
}

function recordedChecks(value: unknown): { kind: string; passed: boolean }[] {
  const checks = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((check) => {
    const kind = text(field(check, "kind"));
    const passed = field(check, "passed");
    return kind !== null && typeof passed === "boolean" ? [{ kind, passed }] : [];
  });
}

/** Reads one rate observation from the immutable assessment input; anything unrecognized stays unknown. */
function recordedRate(rates: unknown, side: "borrow" | "vault"): RecordedRate {
  const observation = field(rates, side);
  const status = text(field(observation, "status"));
  if (status === null) return UNRECORDED_RATE;
  const value = field(observation, "value");
  const { source, observedAt } = origin(observation);
  return {
    status,
    reasons: reasonList(field(observation, "reasons")),
    value: bigintText(field(value, "value")),
    scale: bigintText(field(value, "scale")),
    convention: text(field(value, "convention")),
    window: text(field(value, "window")),
    source,
    observedAt,
  };
}

function hexBytes(address: string): string {
  return address.slice(2).toLowerCase();
}

function decimal(value: string | bigint): string {
  return String(value);
}

function nullableDecimal(value: string | bigint | null): string | null {
  return value === null ? null : decimal(value);
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error("incomplete canonical snapshot row");
  return value;
}

async function queryRows<T>(executor: RecordedAccountDatabase, query: SQL): Promise<T[]> {
  const result = await executor.execute(query) as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : result.rows ?? [];
}
