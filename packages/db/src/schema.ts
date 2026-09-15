import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  pgTable,
} from "drizzle-orm/pg-core";

export const numeric78 = customType<{ data: bigint; driverData: string }>({
  dataType() {
    return "numeric(78,0)";
  },
  toDriver(value) {
    return value.toString();
  },
  fromDriver(value) {
    return BigInt(value);
  },
});

export const binary = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

const utc = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

function verificationColumns() {
  return {
    sourceUrl: text("source_url").notNull(),
    verifiedBlockNumber: numeric78("verified_block_number").notNull(),
    verifiedBlockHash: binary("verified_block_hash").notNull(),
    verifiedAt: utc("verified_at").notNull(),
    status: text("status").notNull(),
  };
}

function blockScopedColumns() {
  return {
    blockNumber: numeric78("block_number").notNull(),
    blockHash: binary("block_hash").notNull(),
    blockTime: utc("block_time").notNull(),
    canonical: boolean("canonical").notNull().default(true),
    observedAt: utc("observed_at").notNull(),
    providerKey: text("provider_key").notNull(),
    reorgedAt: utc("reorged_at"),
  };
}

export const networks = pgTable("networks", {
  chainId: bigint("chain_id", { mode: "bigint" }).primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nativeSymbol: text("native_symbol").notNull(),
  confirmationDepth: integer("confirmation_depth").notNull(),
  enabled: boolean("enabled").notNull().default(true),
}, (table) => [
  unique("networks_slug_unique").on(table.slug),
  check("networks_confirmation_depth_nonnegative", sql`${table.confirmationDepth} >= 0`),
]).enableRLS();

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerUid: binary("provider_uid"),
  canonicalSymbol: text("canonical_symbol").notNull(),
  kind: text("kind").notNull(),
  underlyingSymbol: text("underlying_symbol"),
  jurisdictionNoteVersion: text("jurisdiction_note_version"),
  metadataJson: jsonb("metadata_json").notNull(),
}, (table) => [
  check("assets_kind_valid", sql`${table.kind} in ('stock_token','crypto','stablecoin','vault_share')`),
]).enableRLS();

export const tokenDeployments = pgTable("token_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  chainId: bigint("chain_id", { mode: "bigint" }).notNull().references(() => networks.chainId),
  address: binary("address").notNull(),
  decimals: smallint("decimals").notNull(),
  codeHash: binary("code_hash").notNull(),
  ...verificationColumns(),
}, (table) => [
  unique("token_deployments_chain_address_unique").on(table.chainId, table.address),
  unique("token_deployments_id_asset_unique").on(table.id, table.assetId),
  index("token_deployments_asset_id_idx").on(table.assetId),
  index("token_deployments_chain_id_idx").on(table.chainId),
  check("token_deployments_address_length", sql`octet_length(${table.address}) = 20`),
  check("token_deployments_code_hash_length", sql`octet_length(${table.codeHash}) = 32`),
  check("token_deployments_decimals_range", sql`${table.decimals} between 0 and 255`),
]).enableRLS();

export const morphoDeployments = pgTable("morpho_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: bigint("chain_id", { mode: "bigint" }).notNull().references(() => networks.chainId),
  address: binary("address").notNull(),
  codeHash: binary("code_hash").notNull(),
  version: text("version").notNull(),
  ...verificationColumns(),
}, (table) => [
  unique("morpho_deployments_chain_address_unique").on(table.chainId, table.address),
  index("morpho_deployments_chain_id_idx").on(table.chainId),
  check("morpho_deployments_address_length", sql`octet_length(${table.address}) = 20`),
  check("morpho_deployments_code_hash_length", sql`octet_length(${table.codeHash}) = 32`),
]).enableRLS();

export const morphoMarkets = pgTable("morpho_markets", {
  id: binary("id").primaryKey(),
  morphoDeploymentId: uuid("morpho_deployment_id").notNull().references(() => morphoDeployments.id),
  loanTokenId: uuid("loan_token_id").notNull().references(() => tokenDeployments.id),
  collateralTokenId: uuid("collateral_token_id").notNull().references(() => tokenDeployments.id),
  oracleAddress: binary("oracle_address").notNull(),
  irmAddress: binary("irm_address").notNull(),
  lltvWad: numeric78("lltv_wad").notNull(),
  paramsHashVerified: boolean("params_hash_verified").notNull(),
  status: text("status").notNull(),
  statusReasonCodes: text("status_reason_codes").array().notNull().default(sql`'{}'::text[]`),
  verifiedAt: utc("verified_at").notNull(),
}, (table) => [
  unique("morpho_markets_route_unique").on(table.id, table.loanTokenId, table.lltvWad),
  index("morpho_markets_deployment_id_idx").on(table.morphoDeploymentId),
  index("morpho_markets_loan_token_id_idx").on(table.loanTokenId),
  index("morpho_markets_collateral_token_id_idx").on(table.collateralTokenId),
  check("morpho_markets_id_length", sql`octet_length(${table.id}) = 32`),
  check("morpho_markets_oracle_length", sql`octet_length(${table.oracleAddress}) = 20`),
  check("morpho_markets_irm_length", sql`octet_length(${table.irmAddress}) = 20`),
  check("morpho_markets_lltv_range", sql`${table.lltvWad} > 0 and ${table.lltvWad} <= 1000000000000000000`),
]).enableRLS();

export const vaultDeployments = pgTable("vault_deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: bigint("chain_id", { mode: "bigint" }).notNull().references(() => networks.chainId),
  address: binary("address").notNull(),
  assetTokenId: uuid("asset_token_id").notNull().references(() => tokenDeployments.id),
  shareDecimals: smallint("share_decimals").notNull(),
  interfaceKind: text("interface_kind").notNull(),
  adapterAddress: binary("adapter_address"),
  codeHash: binary("code_hash").notNull(),
  upgradeabilityKind: text("upgradeability_kind").notNull(),
  managerJson: jsonb("manager_json").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
  ...verificationColumns(),
}, (table) => [
  unique("vault_deployments_chain_address_unique").on(table.chainId, table.address),
  unique("vault_deployments_id_asset_unique").on(table.id, table.assetTokenId),
  index("vault_deployments_chain_id_idx").on(table.chainId),
  index("vault_deployments_asset_token_id_idx").on(table.assetTokenId),
  check("vault_deployments_address_length", sql`octet_length(${table.address}) = 20`),
  check("vault_deployments_adapter_length", sql`${table.adapterAddress} is null or octet_length(${table.adapterAddress}) = 20`),
  check("vault_deployments_code_hash_length", sql`octet_length(${table.codeHash}) = 32`),
  check("vault_deployments_interface_valid", sql`${table.interfaceKind} in ('erc4626','fixed_adapter')`),
]).enableRLS();

export const marketSnapshots = pgTable("market_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: binary("market_id").notNull().references(() => morphoMarkets.id),
  totalSupplyAssets: numeric78("total_supply_assets").notNull(),
  totalSupplyShares: numeric78("total_supply_shares").notNull(),
  totalBorrowAssets: numeric78("total_borrow_assets").notNull(),
  totalBorrowShares: numeric78("total_borrow_shares").notNull(),
  availableLoanAssets: numeric78("available_loan_assets").notNull(),
  borrowRateValue: numeric78("borrow_rate_value").notNull(),
  borrowRateScale: numeric78("borrow_rate_scale").notNull(),
  oracleValue: numeric78("oracle_value").notNull(),
  oracleScale: numeric78("oracle_scale").notNull(),
  oracleStatus: text("oracle_status").notNull(),
  sequencerStatus: text("sequencer_status").notNull(),
  routeStatus: text("route_status").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
  ...blockScopedColumns(),
}, (table) => [
  unique("market_snapshots_market_block_unique").on(table.marketId, table.blockHash),
  index("market_snapshots_market_id_idx").on(table.marketId),
  check("market_snapshots_rate_scale_positive", sql`${table.borrowRateScale} > 0`),
  check("market_snapshots_oracle_scale_positive", sql`${table.oracleScale} > 0`),
]).enableRLS();

export const vaultSnapshots = pgTable("vault_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  vaultDeploymentId: uuid("vault_deployment_id").notNull().references(() => vaultDeployments.id),
  totalAssets: numeric78("total_assets").notNull(),
  totalSupplyShares: numeric78("total_supply_shares").notNull(),
  maxDepositAssets: numeric78("max_deposit_assets").notNull(),
  maxWithdrawAssets: numeric78("max_withdraw_assets").notNull(),
  previewRedeemAssets: numeric78("preview_redeem_assets").notNull(),
  pauseStatus: text("pause_status").notNull(),
  downstreamJson: jsonb("downstream_json").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
  ...blockScopedColumns(),
}, (table) => [
  unique("vault_snapshots_vault_block_unique").on(table.vaultDeploymentId, table.blockHash),
  index("vault_snapshots_vault_deployment_id_idx").on(table.vaultDeploymentId),
]).enableRLS();

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: binary("address").notNull(),
  firstSeenAt: utc("first_seen_at").notNull(),
  lastSeenAt: utc("last_seen_at").notNull(),
}, (table) => [
  unique("owners_address_unique").on(table.address),
  check("owners_address_length", sql`octet_length(${table.address}) = 20`),
]).enableRLS();

export const crestAccounts = pgTable("crest_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  chainId: bigint("chain_id", { mode: "bigint" }).notNull().references(() => networks.chainId),
  address: binary("address").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id),
  deploymentTransactionHash: binary("deployment_transaction_hash").notNull(),
  deploymentBlockNumber: numeric78("deployment_block_number").notNull(),
  contractVersion: text("contract_version").notNull(),
  codeHash: binary("code_hash").notNull(),
  indexedPolicyNonce: numeric78("indexed_policy_nonce").notNull(),
  status: text("status").notNull(),
}, (table) => [
  unique("crest_accounts_chain_address_unique").on(table.chainId, table.address),
  unique("crest_accounts_id_address_unique").on(table.id, table.address),
  index("crest_accounts_owner_id_idx").on(table.ownerId),
  index("crest_accounts_chain_id_idx").on(table.chainId),
  check("crest_accounts_address_length", sql`octet_length(${table.address}) = 20`),
]).enableRLS();

export const accountSnapshots = pgTable("account_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  crestAccountId: uuid("crest_account_id").notNull().references(() => crestAccounts.id),
  ownerAddress: binary("owner_address").notNull(),
  guardianAddress: binary("guardian_address").notNull(),
  marketId: binary("market_id").notNull().references(() => morphoMarkets.id),
  vaultDeploymentId: uuid("vault_deployment_id").notNull().references(() => vaultDeployments.id),
  maxCollateralAssets: numeric78("max_collateral_assets").notNull(),
  debtCeilingAssets: numeric78("debt_ceiling_assets").notNull(),
  maxStrategyAssets: numeric78("max_strategy_assets").notNull(),
  reserveFloorAssets: numeric78("reserve_floor_assets").notNull(),
  strategyFloorAssets: numeric78("strategy_floor_assets").notNull(),
  maxRepayPerActionAssets: numeric78("max_repay_per_action_assets").notNull(),
  lowerLtvWad: numeric78("lower_ltv_wad").notNull(),
  targetLtvWad: numeric78("target_ltv_wad").notNull(),
  upperLtvWad: numeric78("upper_ltv_wad").notNull(),
  criticalLtvWad: numeric78("critical_ltv_wad").notNull(),
  borrowingFrozen: boolean("borrowing_frozen").notNull(),
  policyNonce: numeric78("policy_nonce").notNull(),
  loanTokenBalance: numeric78("loan_token_balance").notNull(),
  collateralTokenBalance: numeric78("collateral_token_balance").notNull(),
  vaultShareBalance: numeric78("vault_share_balance").notNull(),
  ...blockScopedColumns(),
}, (table) => [
  unique("account_snapshots_account_block_unique").on(table.crestAccountId, table.blockHash),
  index("account_snapshots_account_id_idx").on(table.crestAccountId),
  index("account_snapshots_market_id_idx").on(table.marketId),
  index("account_snapshots_vault_id_idx").on(table.vaultDeploymentId),
  check("account_snapshots_ltv_ordered", sql`${table.lowerLtvWad} < ${table.targetLtvWad} and ${table.targetLtvWad} < ${table.upperLtvWad} and ${table.upperLtvWad} < ${table.criticalLtvWad}`),
]).enableRLS();

export const positionSnapshots = pgTable("position_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  crestAccountId: uuid("crest_account_id").notNull().references(() => crestAccounts.id),
  marketId: binary("market_id").notNull().references(() => morphoMarkets.id),
  borrowShares: numeric78("borrow_shares").notNull(),
  borrowAssetsUp: numeric78("borrow_assets_up").notNull(),
  collateralAssets: numeric78("collateral_assets").notNull(),
  collateralValue: numeric78("collateral_value").notNull(),
  ltvWad: numeric78("ltv_wad"),
  morphoHealthWad: numeric78("morpho_health_wad"),
  ...blockScopedColumns(),
}, (table) => [
  unique("position_snapshots_account_market_block_unique").on(table.crestAccountId, table.marketId, table.blockHash),
  index("position_snapshots_account_id_idx").on(table.crestAccountId),
  index("position_snapshots_market_id_idx").on(table.marketId),
  check("position_snapshots_no_debt_null_health", sql`${table.borrowAssetsUp} > 0 or (${table.ltvWad} is null and ${table.morphoHealthWad} is null)`),
]).enableRLS();

export const strategyPositionSnapshots = pgTable("strategy_position_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  crestAccountId: uuid("crest_account_id").notNull().references(() => crestAccounts.id),
  vaultDeploymentId: uuid("vault_deployment_id").notNull().references(() => vaultDeployments.id),
  shareBalance: numeric78("share_balance").notNull(),
  quotedAssets: numeric78("quoted_assets").notNull(),
  maxWithdrawableAssets: numeric78("max_withdrawable_assets").notNull(),
  strategyFloorAssets: numeric78("strategy_floor_assets").notNull(),
  actionableAssets: numeric78("actionable_assets").notNull(),
  ...blockScopedColumns(),
}, (table) => [
  unique("strategy_position_account_vault_block_unique").on(table.crestAccountId, table.vaultDeploymentId, table.blockHash),
  index("strategy_position_account_id_idx").on(table.crestAccountId),
  index("strategy_position_vault_id_idx").on(table.vaultDeploymentId),
  check("strategy_position_actionable_bounded", sql`${table.actionableAssets} <= ${table.maxWithdrawableAssets}`),
]).enableRLS();

export const robinhoodSignals = pgTable("robinhood_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  kind: text("kind").notNull(),
  providerSignalId: text("provider_signal_id").notNull(),
  providerGeneratedAt: utc("provider_generated_at"),
  fetchedAt: utc("fetched_at").notNull(),
  expiresAt: utc("expires_at").notNull(),
  status: text("status").notNull(),
  validatedPayload: jsonb("validated_payload").notNull(),
  payloadHash: binary("payload_hash").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
}, (table) => [
  unique("robinhood_signals_provider_id_unique").on(table.kind, table.providerSignalId),
  index("robinhood_signals_asset_id_idx").on(table.assetId),
  check("robinhood_signals_kind_valid", sql`${table.kind} in ('asset_status','underlying_price','halt','multiplier')`),
]).enableRLS();

export const corporateActions = pgTable("corporate_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id").notNull().references(() => assets.id),
  providerActionId: text("provider_action_id").notNull(),
  actionType: text("action_type").notNull(),
  status: text("status").notNull(),
  details: jsonb("details").notNull(),
  payloadHash: binary("payload_hash").notNull(),
  firstSeenAt: utc("first_seen_at").notNull(),
  lastSeenAt: utc("last_seen_at").notNull(),
}, (table) => [
  unique("corporate_actions_provider_id_unique").on(table.providerActionId),
  index("corporate_actions_asset_id_idx").on(table.assetId),
]).enableRLS();

export const rateObservations = pgTable("rate_observations", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectKind: text("subject_kind").notNull(),
  marketId: binary("market_id").references(() => morphoMarkets.id),
  vaultDeploymentId: uuid("vault_deployment_id").references(() => vaultDeployments.id),
  rateValue: numeric78("rate_value").notNull(),
  rateScale: numeric78("rate_scale").notNull(),
  periodKind: text("period_kind").notNull(),
  grossOrNet: text("gross_or_net").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceGeneratedAt: utc("source_generated_at"),
  fetchedAt: utc("fetched_at").notNull(),
  expiresAt: utc("expires_at").notNull(),
  status: text("status").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
}, (table) => [
  index("rate_observations_market_id_idx").on(table.marketId),
  index("rate_observations_vault_id_idx").on(table.vaultDeploymentId),
  check("rate_observations_one_subject", sql`num_nonnulls(${table.marketId}, ${table.vaultDeploymentId}) = 1`),
  check("rate_observations_scale_positive", sql`${table.rateScale} > 0`),
]).enableRLS();

export const assetIntents = pgTable("asset_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => owners.id),
  crestAccountId: uuid("crest_account_id").references(() => crestAccounts.id),
  tokenDeploymentId: uuid("token_deployment_id").notNull().references(() => tokenDeployments.id),
  intent: text("intent").notNull(),
  marketId: binary("market_id").references(() => morphoMarkets.id),
  vaultDeploymentId: uuid("vault_deployment_id").references(() => vaultDeployments.id),
  policyVersion: integer("policy_version"),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
  preparedCalldataHash: binary("prepared_calldata_hash"),
  createdAt: utc("created_at").notNull(),
  effectiveAt: utc("effective_at"),
}, (table) => [
  index("asset_intents_owner_id_idx").on(table.ownerId),
  index("asset_intents_account_id_idx").on(table.crestAccountId),
  index("asset_intents_token_id_idx").on(table.tokenDeploymentId),
  check("asset_intents_kind_valid", sql`${table.intent} in ('KEEP','PROTECT_AND_BORROW','EARN_STABLE','EARN_ASSET','UNSUPPORTED')`),
  check("asset_intents_no_forbidden_calldata", sql`${table.intent} not in ('KEEP','UNSUPPORTED') or ${table.preparedCalldataHash} is null`),
]).enableRLS();

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  crestAccountId: uuid("crest_account_id").notNull().references(() => crestAccounts.id),
  policyNonce: numeric78("policy_nonce").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  typedJson: jsonb("typed_json").notNull(),
  contentHash: binary("content_hash").notNull(),
  source: text("source").notNull(),
  configurationTransactionHash: binary("configuration_transaction_hash"),
  effectiveBlockNumber: numeric78("effective_block_number"),
  effectiveBlockHash: binary("effective_block_hash"),
  status: text("status").notNull(),
  marketId: binary("market_id").notNull(),
  vaultDeploymentId: uuid("vault_deployment_id").notNull(),
  loanTokenId: uuid("loan_token_id").notNull(),
  marketLltvWad: numeric78("market_lltv_wad").notNull(),
  draftedAt: utc("drafted_at"),
  activatedAt: utc("activated_at"),
  invalidatedAt: utc("invalidated_at"),
}, (table) => [
  unique("policies_account_nonce_unique").on(table.crestAccountId, table.policyNonce),
  unique("policies_account_content_hash_unique").on(table.crestAccountId, table.contentHash),
  unique("policies_id_market_lltv_unique").on(table.id, table.marketLltvWad),
  index("policies_account_id_idx").on(table.crestAccountId),
  index("policies_market_id_idx").on(table.marketId),
  index("policies_vault_id_idx").on(table.vaultDeploymentId),
  foreignKey({
    name: "policies_market_route_fk",
    columns: [table.marketId, table.loanTokenId, table.marketLltvWad],
    foreignColumns: [morphoMarkets.id, morphoMarkets.loanTokenId, morphoMarkets.lltvWad],
  }),
  foreignKey({
    name: "policies_vault_asset_fk",
    columns: [table.vaultDeploymentId, table.loanTokenId],
    foreignColumns: [vaultDeployments.id, vaultDeployments.assetTokenId],
  }),
  check("policies_source_valid", sql`${table.source} in ('manual','llm_import')`),
  check("policies_status_valid", sql`${table.status} in ('pending','active','superseded','reorged','rejected')`),
]).enableRLS();

export const marketPolicies = pgTable("market_policies", {
  policyId: uuid("policy_id").primaryKey().references(() => policies.id),
  maxCollateralAssets: numeric78("max_collateral_assets").notNull(),
  debtCeilingAssets: numeric78("debt_ceiling_assets").notNull(),
  enabled: boolean("enabled").notNull(),
}, (table) => [
  check("market_policies_caps_positive", sql`${table.maxCollateralAssets} > 0 and ${table.debtCeilingAssets} > 0`),
]).enableRLS();

export const strategyPolicies = pgTable("strategy_policies", {
  policyId: uuid("policy_id").primaryKey().references(() => policies.id),
  maxStrategyAssets: numeric78("max_strategy_assets").notNull(),
  strategyFloorAssets: numeric78("strategy_floor_assets").notNull(),
  minimumNetSpreadBps: integer("minimum_net_spread_bps").notNull(),
  enabled: boolean("enabled").notNull(),
}, (table) => [
  check("strategy_policies_floor_bounded", sql`${table.strategyFloorAssets} <= ${table.maxStrategyAssets}`),
]).enableRLS();

export const reservePolicies = pgTable("reserve_policies", {
  policyId: uuid("policy_id").primaryKey().references(() => policies.id),
  loanTokenId: uuid("loan_token_id").notNull().references(() => tokenDeployments.id),
  reserveFloorAssets: numeric78("reserve_floor_assets").notNull(),
  maxRepayPerActionAssets: numeric78("max_repay_per_action_assets").notNull(),
}, (table) => [
  check("reserve_policies_repay_cap_positive", sql`${table.maxRepayPerActionAssets} > 0`),
]).enableRLS();

export const ltvPolicies = pgTable("ltv_policies", {
  policyId: uuid("policy_id").primaryKey(),
  lowerLtvWad: numeric78("lower_ltv_wad").notNull(),
  targetLtvWad: numeric78("target_ltv_wad").notNull(),
  upperLtvWad: numeric78("upper_ltv_wad").notNull(),
  criticalLtvWad: numeric78("critical_ltv_wad").notNull(),
  marketLltvWad: numeric78("market_lltv_wad").notNull(),
}, (table) => [
  foreignKey({
    name: "ltv_policies_policy_lltv_fk",
    columns: [table.policyId, table.marketLltvWad],
    foreignColumns: [policies.id, policies.marketLltvWad],
  }),
  check("ltv_policies_ordered", sql`${table.lowerLtvWad} >= 0 and ${table.lowerLtvWad} < ${table.targetLtvWad} and ${table.targetLtvWad} < ${table.upperLtvWad} and ${table.upperLtvWad} < ${table.criticalLtvWad} and ${table.criticalLtvWad} < ${table.marketLltvWad}`),
]).enableRLS();

export const riskAssessments = pgTable("risk_assessments", {
  id: text("id").primaryKey(),
  crestAccountId: uuid("crest_account_id").notNull().references(() => crestAccounts.id),
  policyId: uuid("policy_id").notNull().references(() => policies.id),
  accountSnapshotId: uuid("account_snapshot_id").references(() => accountSnapshots.id),
  positionSnapshotId: uuid("position_snapshot_id").references(() => positionSnapshots.id),
  strategyPositionSnapshotId: uuid("strategy_position_snapshot_id").references(() => strategyPositionSnapshots.id),
  marketSnapshotId: uuid("market_snapshot_id").references(() => marketSnapshots.id),
  vaultSnapshotId: uuid("vault_snapshot_id").references(() => vaultSnapshots.id),
  riskEngineVersion: text("risk_engine_version").notNull(),
  status: text("status").notNull(),
  ltvWad: numeric78("ltv_wad"),
  morphoHealthWad: numeric78("morpho_health_wad"),
  policyHealthWad: numeric78("policy_health_wad"),
  ownerBorrowCapacityAssets: numeric78("owner_borrow_capacity_assets").notNull(),
  repayCapacityAssets: numeric78("repay_capacity_assets").notNull(),
  estimatedAnnualCarryAssets: numeric78("estimated_annual_carry_assets").notNull(),
  estimatedSpreadBps: integer("estimated_spread_bps").notNull(),
  recommendedAction: text("recommended_action").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
  canonicalInputHash: binary("canonical_input_hash").notNull(),
  createdAt: utc("created_at").notNull(),
  invalidatedAt: utc("invalidated_at"),
  invalidationReason: text("invalidation_reason"),
}, (table) => [
  index("risk_assessments_account_id_idx").on(table.crestAccountId),
  index("risk_assessments_policy_id_idx").on(table.policyId),
  check("risk_assessments_state_valid", sql`${table.status} in ('NORMAL','HARVESTABLE','UPSIZE_AVAILABLE','PROTECT','EXIT_YIELD','CRITICAL','DEGRADED')`),
  check("risk_assessments_action_valid", sql`${table.recommendedAction} in ('none','owner_borrow','freeze','repay_reserve','repay_strategy','owner_review')`),
  check("risk_assessments_degraded_capacity_zero", sql`${table.status} <> 'DEGRADED' or ${table.ownerBorrowCapacityAssets} = 0`),
]).enableRLS();

export const assessmentInputs = pgTable("assessment_inputs", {
  assessmentId: text("assessment_id").notNull().references(() => riskAssessments.id),
  inputKind: text("input_kind").notNull(),
  observationId: uuid("observation_id").notNull(),
  purpose: text("purpose").notNull(),
}, (table) => [
  primaryKey({ columns: [table.assessmentId, table.inputKind, table.observationId] }),
  index("assessment_inputs_observation_id_idx").on(table.observationId),
]).enableRLS();

export const stressScenarios = pgTable("stress_scenarios", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull(),
  provenance: text("provenance").notNull(),
  status: text("status").notNull(),
  configuration: jsonb("configuration").notNull(),
  createdAt: utc("created_at").notNull(),
}, (table) => [
  check("stress_scenarios_status_valid", sql`${table.status} in ('illustrative','calibrated')`),
]).enableRLS();

export const scenarioResults = pgTable("scenario_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  assessmentId: text("assessment_id").notNull().references(() => riskAssessments.id),
  scenarioId: uuid("scenario_id").notNull().references(() => stressScenarios.id),
  stressedCollateralValue: numeric78("stressed_collateral_value").notNull(),
  stressedDebtAssets: numeric78("stressed_debt_assets").notNull(),
  stressedVaultLiquidityAssets: numeric78("stressed_vault_liquidity_assets").notNull(),
  stressedHealthWad: numeric78("stressed_health_wad"),
  stressedCapacityAssets: numeric78("stressed_capacity_assets").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
}, (table) => [
  unique("scenario_results_assessment_scenario_unique").on(table.assessmentId, table.scenarioId),
  index("scenario_results_assessment_id_idx").on(table.assessmentId),
  index("scenario_results_scenario_id_idx").on(table.scenarioId),
]).enableRLS();

export const realizedStrategyEvents = pgTable("realized_strategy_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  crestAccountId: uuid("crest_account_id").notNull().references(() => crestAccounts.id),
  kind: text("kind").notNull(),
  transactionHash: binary("transaction_hash").notNull(),
  sharesBefore: numeric78("shares_before").notNull(),
  sharesAfter: numeric78("shares_after").notNull(),
  assetsBefore: numeric78("assets_before").notNull(),
  assetsAfter: numeric78("assets_after").notNull(),
  debtBeforeAssets: numeric78("debt_before_assets").notNull(),
  debtAfterAssets: numeric78("debt_after_assets").notNull(),
  debtRepaidAssets: numeric78("debt_repaid_assets").notNull(),
  attributedFeesAssets: numeric78("attributed_fees_assets"),
  blockNumber: numeric78("block_number").notNull(),
  blockHash: binary("block_hash").notNull(),
  blockTime: utc("block_time").notNull(),
  canonical: boolean("canonical").notNull(),
  observedAt: utc("observed_at").notNull(),
  reorgedAt: utc("reorged_at"),
}, (table) => [
  unique("realized_strategy_events_transaction_unique").on(table.transactionHash, table.kind),
  index("realized_strategy_events_account_id_idx").on(table.crestAccountId),
  check("realized_strategy_events_kind_valid", sql`${table.kind} in ('deposit','withdraw','repay')`),
  check("realized_strategy_events_repay_reconciles", sql`${table.kind} <> 'repay' or (${table.debtBeforeAssets} > ${table.debtAfterAssets} and ${table.debtRepaidAssets} = ${table.debtBeforeAssets} - ${table.debtAfterAssets} and ${table.debtRepaidAssets} > 0)`),
]).enableRLS();

export const automationTriggers = pgTable("automation_triggers", {
  id: text("id").primaryKey(),
  idempotencyKey: binary("idempotency_key").notNull(),
  assessmentId: text("assessment_id").notNull().references(() => riskAssessments.id),
  policyId: uuid("policy_id").notNull().references(() => policies.id),
  actionKind: text("action_kind").notNull(),
  requestedAssets: numeric78("requested_assets"),
  status: text("status").notNull(),
  reasonCodes: text("reason_codes").array().notNull().default(sql`'{}'::text[]`),
  detectedAt: utc("detected_at").notNull(),
  claimedAt: utc("claimed_at"),
  leaseExpiresAt: utc("lease_expires_at"),
  completedAt: utc("completed_at"),
}, (table) => [
  unique("automation_triggers_idempotency_unique").on(table.idempotencyKey),
  index("automation_triggers_assessment_id_idx").on(table.assessmentId),
  index("automation_triggers_policy_id_idx").on(table.policyId),
  check("automation_triggers_action_valid", sql`${table.actionKind} in ('freeze','repay_reserve','repay_strategy')`),
  check("automation_triggers_amount_shape", sql`(${table.actionKind} = 'freeze' and ${table.requestedAssets} is null) or (${table.actionKind} <> 'freeze' and ${table.requestedAssets} > 0)`),
]).enableRLS();

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  triggerId: text("trigger_id").notNull().references(() => automationTriggers.id),
  status: text("status").notNull(),
  guardianAddress: binary("guardian_address").notNull(),
  selector: text("selector").notNull(),
  observedPolicyNonce: numeric78("observed_policy_nonce").notNull(),
  failureClass: text("failure_class"),
  retryCount: integer("retry_count").notNull(),
  startedAt: utc("started_at").notNull(),
  finishedAt: utc("finished_at"),
}, (table) => [
  unique("automation_runs_trigger_unique").on(table.triggerId),
  check("automation_runs_selector_allowed", sql`${table.selector} in ('freezeBorrowing()','repayFromReserve(uint256)','repayFromStrategy(uint256)')`),
  check("automation_runs_retry_nonnegative", sql`${table.retryCount} >= 0`),
]).enableRLS();

export const transactionAttempts = pgTable("transaction_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => automationRuns.id),
  attemptNumber: integer("attempt_number").notNull(),
  chainId: bigint("chain_id", { mode: "bigint" }).notNull().references(() => networks.chainId),
  crestAccountId: uuid("crest_account_id").notNull(),
  fromAddress: binary("from_address").notNull(),
  toAddress: binary("to_address").notNull(),
  calldataHash: binary("calldata_hash").notNull(),
  decodedOperation: text("decoded_operation").notNull(),
  simulationBlockNumber: numeric78("simulation_block_number").notNull(),
  simulationSuccess: boolean("simulation_success").notNull(),
  simulationGas: numeric78("simulation_gas"),
  nonce: numeric78("nonce"),
  transactionHash: binary("transaction_hash"),
  submissionStatus: text("submission_status").notNull(),
  error: text("error"),
  submittedAt: utc("submitted_at"),
}, (table) => [
  unique("transaction_attempts_run_number_unique").on(table.runId, table.attemptNumber),
  uniqueIndex("transaction_attempts_hash_unique").on(table.transactionHash).where(sql`${table.transactionHash} is not null`),
  index("transaction_attempts_account_id_idx").on(table.crestAccountId),
  foreignKey({
    name: "transaction_attempts_fixed_target_fk",
    columns: [table.crestAccountId, table.toAddress],
    foreignColumns: [crestAccounts.id, crestAccounts.address],
  }),
  check("transaction_attempts_operation_allowed", sql`${table.decodedOperation} in ('freezeBorrowing()','repayFromReserve(uint256)','repayFromStrategy(uint256)')`),
  check("transaction_attempts_number_positive", sql`${table.attemptNumber} > 0`),
]).enableRLS();

export const transactionReceipts = pgTable("transaction_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  attemptId: uuid("attempt_id").notNull().references(() => transactionAttempts.id),
  blockNumber: numeric78("block_number").notNull(),
  blockHash: binary("block_hash").notNull(),
  canonical: boolean("canonical").notNull(),
  success: boolean("success").notNull(),
  revertReason: text("revert_reason"),
  gasUsed: numeric78("gas_used").notNull(),
  decodedEvents: jsonb("decoded_events").notNull(),
  observedAt: utc("observed_at").notNull(),
  reorgedAt: utc("reorged_at"),
}, (table) => [
  unique("transaction_receipts_attempt_unique").on(table.attemptId),
]).enableRLS();

export const postconditionChecks = pgTable("postcondition_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => automationRuns.id),
  kind: text("kind").notNull(),
  passed: boolean("passed").notNull(),
  expectedJson: jsonb("expected_json").notNull(),
  actualJson: jsonb("actual_json").notNull(),
  checkedBlockNumber: numeric78("checked_block_number").notNull(),
  checkedBlockHash: binary("checked_block_hash").notNull(),
  checkedAt: utc("checked_at").notNull(),
}, (table) => [
  unique("postcondition_checks_run_kind_unique").on(table.runId, table.kind),
  index("postcondition_checks_run_id_idx").on(table.runId),
  check("postcondition_checks_kind_valid", sql`${table.kind} in ('frozen','debt_decreased','reserve_floor_held','strategy_floor_held','vault_receiver_fixed','repay_beneficiary_fixed')`),
]).enableRLS();

export const indexerCursors = pgTable("indexer_cursors", {
  chainId: bigint("chain_id", { mode: "bigint" }).notNull().references(() => networks.chainId),
  streamKey: text("stream_key").notNull(),
  lastCanonicalBlockNumber: numeric78("last_canonical_block_number").notNull(),
  lastCanonicalBlockHash: binary("last_canonical_block_hash").notNull(),
  updatedAt: utc("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.chainId, table.streamKey] }),
]).enableRLS();
