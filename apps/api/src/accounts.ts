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
}

export interface AccountAssessment {
  status: string;
  createdAt: string;
  reasonCodes: string[];
  ownerBorrowCapacityAssets: string | null;
  projectedCarryAssets: string | null;
  projectedSpreadBps: string | null;
}

export interface AccountPositionResponse {
  evidence: "recorded";
  account: RecordedAccount;
  snapshot: AccountSnapshot | null;
  assessment: AccountAssessment | null;
  realizedDebtRepaidAssets: string | null;
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
  assessmentStatus: string | null;
  assessmentCreatedAt: Date | string | null;
  assessmentReasonCodes: string[] | null;
  ownerBorrowCapacityAssets: string | bigint | null;
  projectedCarryAssets: string | bigint | null;
  projectedSpreadBps: string | bigint | null;
  realizedDebtRepaidAssets: string | bigint | null;
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
            s.max_withdrawable_assets
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
          assessment.status as "assessmentStatus",
          assessment.created_at as "assessmentCreatedAt",
          assessment.reason_codes as "assessmentReasonCodes",
          assessment.owner_borrow_capacity_assets as "ownerBorrowCapacityAssets",
          assessment.estimated_annual_carry_assets as "projectedCarryAssets",
          assessment.estimated_spread_bps as "projectedSpreadBps",
          realized.debt_repaid_assets as "realizedDebtRepaidAssets"
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
  };
  const assessment = row.assessmentStatus === null ? null : {
    createdAt: timestamp(required(row.assessmentCreatedAt)),
    status: row.assessmentStatus,
    reasonCodes: row.assessmentReasonCodes ?? [],
    ownerBorrowCapacityAssets: nullableDecimal(row.ownerBorrowCapacityAssets),
    projectedCarryAssets: nullableDecimal(row.projectedCarryAssets),
    projectedSpreadBps: nullableDecimal(row.projectedSpreadBps),
  };

  return {
    evidence: "recorded",
    account: toAccount(row),
    snapshot,
    assessment,
    realizedDebtRepaidAssets: nullableDecimal(row.realizedDebtRepaidAssets),
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
