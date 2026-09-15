CREATE TABLE "account_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"owner_address" "bytea" NOT NULL,
	"guardian_address" "bytea" NOT NULL,
	"market_id" "bytea" NOT NULL,
	"vault_deployment_id" uuid NOT NULL,
	"max_collateral_assets" numeric(78,0) NOT NULL,
	"debt_ceiling_assets" numeric(78,0) NOT NULL,
	"max_strategy_assets" numeric(78,0) NOT NULL,
	"reserve_floor_assets" numeric(78,0) NOT NULL,
	"strategy_floor_assets" numeric(78,0) NOT NULL,
	"max_repay_per_action_assets" numeric(78,0) NOT NULL,
	"lower_ltv_wad" numeric(78,0) NOT NULL,
	"target_ltv_wad" numeric(78,0) NOT NULL,
	"upper_ltv_wad" numeric(78,0) NOT NULL,
	"critical_ltv_wad" numeric(78,0) NOT NULL,
	"borrowing_frozen" boolean NOT NULL,
	"policy_nonce" numeric(78,0) NOT NULL,
	"loan_token_balance" numeric(78,0) NOT NULL,
	"collateral_token_balance" numeric(78,0) NOT NULL,
	"vault_share_balance" numeric(78,0) NOT NULL,
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"provider_key" text NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "account_snapshots_account_block_unique" UNIQUE("crest_account_id","block_hash"),
	CONSTRAINT "account_snapshots_ltv_ordered" CHECK ("account_snapshots"."lower_ltv_wad" < "account_snapshots"."target_ltv_wad" and "account_snapshots"."target_ltv_wad" < "account_snapshots"."upper_ltv_wad" and "account_snapshots"."upper_ltv_wad" < "account_snapshots"."critical_ltv_wad")
);
--> statement-breakpoint
ALTER TABLE "account_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assessment_inputs" (
	"assessment_id" text NOT NULL,
	"input_kind" text NOT NULL,
	"observation_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	CONSTRAINT "assessment_inputs_assessment_id_input_kind_observation_id_pk" PRIMARY KEY("assessment_id","input_kind","observation_id")
);
--> statement-breakpoint
ALTER TABLE "assessment_inputs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "asset_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"crest_account_id" uuid,
	"token_deployment_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"market_id" "bytea",
	"vault_deployment_id" uuid,
	"policy_version" integer,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"prepared_calldata_hash" "bytea",
	"created_at" timestamp with time zone NOT NULL,
	"effective_at" timestamp with time zone,
	CONSTRAINT "asset_intents_kind_valid" CHECK ("asset_intents"."intent" in ('KEEP','PROTECT_AND_BORROW','EARN_STABLE','EARN_ASSET','UNSUPPORTED')),
	CONSTRAINT "asset_intents_no_forbidden_calldata" CHECK ("asset_intents"."intent" not in ('KEEP','UNSUPPORTED') or "asset_intents"."prepared_calldata_hash" is null)
);
--> statement-breakpoint
ALTER TABLE "asset_intents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_uid" "bytea",
	"canonical_symbol" text NOT NULL,
	"kind" text NOT NULL,
	"underlying_symbol" text,
	"jurisdiction_note_version" text,
	"metadata_json" jsonb NOT NULL,
	CONSTRAINT "assets_kind_valid" CHECK ("assets"."kind" in ('stock_token','crypto','stablecoin','vault_share'))
);
--> statement-breakpoint
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_id" text NOT NULL,
	"status" text NOT NULL,
	"guardian_address" "bytea" NOT NULL,
	"selector" text NOT NULL,
	"observed_policy_nonce" numeric(78,0) NOT NULL,
	"failure_class" text,
	"retry_count" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "automation_runs_trigger_unique" UNIQUE("trigger_id"),
	CONSTRAINT "automation_runs_selector_allowed" CHECK ("automation_runs"."selector" in ('freezeBorrowing()','repayFromReserve(uint256)','repayFromStrategy(uint256)')),
	CONSTRAINT "automation_runs_retry_nonnegative" CHECK ("automation_runs"."retry_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "automation_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" "bytea" NOT NULL,
	"assessment_id" text NOT NULL,
	"policy_id" uuid NOT NULL,
	"action_kind" text NOT NULL,
	"requested_assets" numeric(78,0),
	"status" text NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "automation_triggers_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "automation_triggers_action_valid" CHECK ("automation_triggers"."action_kind" in ('freeze','repay_reserve','repay_strategy')),
	CONSTRAINT "automation_triggers_amount_shape" CHECK (("automation_triggers"."action_kind" = 'freeze' and "automation_triggers"."requested_assets" is null) or ("automation_triggers"."action_kind" <> 'freeze' and "automation_triggers"."requested_assets" > 0))
);
--> statement-breakpoint
ALTER TABLE "automation_triggers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "corporate_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"provider_action_id" text NOT NULL,
	"action_type" text NOT NULL,
	"status" text NOT NULL,
	"details" jsonb NOT NULL,
	"payload_hash" "bytea" NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "corporate_actions_provider_id_unique" UNIQUE("provider_action_id")
);
--> statement-breakpoint
ALTER TABLE "corporate_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "crest_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" "bytea" NOT NULL,
	"owner_id" uuid NOT NULL,
	"deployment_transaction_hash" "bytea" NOT NULL,
	"deployment_block_number" numeric(78,0) NOT NULL,
	"contract_version" text NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"indexed_policy_nonce" numeric(78,0) NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "crest_accounts_chain_address_unique" UNIQUE("chain_id","address"),
	CONSTRAINT "crest_accounts_id_address_unique" UNIQUE("id","address"),
	CONSTRAINT "crest_accounts_address_length" CHECK (octet_length("crest_accounts"."address") = 20)
);
--> statement-breakpoint
ALTER TABLE "crest_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "indexer_cursors" (
	"chain_id" bigint NOT NULL,
	"stream_key" text NOT NULL,
	"last_canonical_block_number" numeric(78,0) NOT NULL,
	"last_canonical_block_hash" "bytea" NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "indexer_cursors_chain_id_stream_key_pk" PRIMARY KEY("chain_id","stream_key")
);
--> statement-breakpoint
ALTER TABLE "indexer_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ltv_policies" (
	"policy_id" uuid PRIMARY KEY NOT NULL,
	"lower_ltv_wad" numeric(78,0) NOT NULL,
	"target_ltv_wad" numeric(78,0) NOT NULL,
	"upper_ltv_wad" numeric(78,0) NOT NULL,
	"critical_ltv_wad" numeric(78,0) NOT NULL,
	"market_lltv_wad" numeric(78,0) NOT NULL,
	CONSTRAINT "ltv_policies_ordered" CHECK ("ltv_policies"."lower_ltv_wad" >= 0 and "ltv_policies"."lower_ltv_wad" < "ltv_policies"."target_ltv_wad" and "ltv_policies"."target_ltv_wad" < "ltv_policies"."upper_ltv_wad" and "ltv_policies"."upper_ltv_wad" < "ltv_policies"."critical_ltv_wad" and "ltv_policies"."critical_ltv_wad" < "ltv_policies"."market_lltv_wad")
);
--> statement-breakpoint
ALTER TABLE "ltv_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_policies" (
	"policy_id" uuid PRIMARY KEY NOT NULL,
	"max_collateral_assets" numeric(78,0) NOT NULL,
	"debt_ceiling_assets" numeric(78,0) NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "market_policies_caps_positive" CHECK ("market_policies"."max_collateral_assets" > 0 and "market_policies"."debt_ceiling_assets" > 0)
);
--> statement-breakpoint
ALTER TABLE "market_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" "bytea" NOT NULL,
	"total_supply_assets" numeric(78,0) NOT NULL,
	"total_supply_shares" numeric(78,0) NOT NULL,
	"total_borrow_assets" numeric(78,0) NOT NULL,
	"total_borrow_shares" numeric(78,0) NOT NULL,
	"available_loan_assets" numeric(78,0) NOT NULL,
	"borrow_rate_value" numeric(78,0) NOT NULL,
	"borrow_rate_scale" numeric(78,0) NOT NULL,
	"oracle_value" numeric(78,0) NOT NULL,
	"oracle_scale" numeric(78,0) NOT NULL,
	"oracle_status" text NOT NULL,
	"sequencer_status" text NOT NULL,
	"route_status" text NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"provider_key" text NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "market_snapshots_market_block_unique" UNIQUE("market_id","block_hash"),
	CONSTRAINT "market_snapshots_rate_scale_positive" CHECK ("market_snapshots"."borrow_rate_scale" > 0),
	CONSTRAINT "market_snapshots_oracle_scale_positive" CHECK ("market_snapshots"."oracle_scale" > 0)
);
--> statement-breakpoint
ALTER TABLE "market_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "morpho_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" "bytea" NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"version" text NOT NULL,
	"source_url" text NOT NULL,
	"verified_block_number" numeric(78,0) NOT NULL,
	"verified_block_hash" "bytea" NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "morpho_deployments_chain_address_unique" UNIQUE("chain_id","address"),
	CONSTRAINT "morpho_deployments_address_length" CHECK (octet_length("morpho_deployments"."address") = 20),
	CONSTRAINT "morpho_deployments_code_hash_length" CHECK (octet_length("morpho_deployments"."code_hash") = 32)
);
--> statement-breakpoint
ALTER TABLE "morpho_deployments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "morpho_markets" (
	"id" "bytea" PRIMARY KEY NOT NULL,
	"morpho_deployment_id" uuid NOT NULL,
	"loan_token_id" uuid NOT NULL,
	"collateral_token_id" uuid NOT NULL,
	"oracle_address" "bytea" NOT NULL,
	"irm_address" "bytea" NOT NULL,
	"lltv_wad" numeric(78,0) NOT NULL,
	"params_hash_verified" boolean NOT NULL,
	"status" text NOT NULL,
	"status_reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	CONSTRAINT "morpho_markets_route_unique" UNIQUE("id","loan_token_id","lltv_wad"),
	CONSTRAINT "morpho_markets_id_length" CHECK (octet_length("morpho_markets"."id") = 32),
	CONSTRAINT "morpho_markets_oracle_length" CHECK (octet_length("morpho_markets"."oracle_address") = 20),
	CONSTRAINT "morpho_markets_irm_length" CHECK (octet_length("morpho_markets"."irm_address") = 20),
	CONSTRAINT "morpho_markets_lltv_range" CHECK ("morpho_markets"."lltv_wad" > 0 and "morpho_markets"."lltv_wad" <= 1000000000000000000)
);
--> statement-breakpoint
ALTER TABLE "morpho_markets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "networks" (
	"chain_id" bigint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"native_symbol" text NOT NULL,
	"confirmation_depth" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "networks_slug_unique" UNIQUE("slug"),
	CONSTRAINT "networks_confirmation_depth_nonnegative" CHECK ("networks"."confirmation_depth" >= 0)
);
--> statement-breakpoint
ALTER TABLE "networks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" "bytea" NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "owners_address_unique" UNIQUE("address"),
	CONSTRAINT "owners_address_length" CHECK (octet_length("owners"."address") = 20)
);
--> statement-breakpoint
ALTER TABLE "owners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"policy_nonce" numeric(78,0) NOT NULL,
	"schema_version" integer NOT NULL,
	"typed_json" jsonb NOT NULL,
	"content_hash" "bytea" NOT NULL,
	"source" text NOT NULL,
	"configuration_transaction_hash" "bytea",
	"effective_block_number" numeric(78,0),
	"effective_block_hash" "bytea",
	"status" text NOT NULL,
	"market_id" "bytea" NOT NULL,
	"vault_deployment_id" uuid NOT NULL,
	"loan_token_id" uuid NOT NULL,
	"market_lltv_wad" numeric(78,0) NOT NULL,
	"drafted_at" timestamp with time zone,
	"activated_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	CONSTRAINT "policies_account_nonce_unique" UNIQUE("crest_account_id","policy_nonce"),
	CONSTRAINT "policies_account_content_hash_unique" UNIQUE("crest_account_id","content_hash"),
	CONSTRAINT "policies_id_market_lltv_unique" UNIQUE("id","market_lltv_wad"),
	CONSTRAINT "policies_source_valid" CHECK ("policies"."source" in ('manual','llm_import')),
	CONSTRAINT "policies_status_valid" CHECK ("policies"."status" in ('pending','active','superseded','reorged','rejected'))
);
--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"market_id" "bytea" NOT NULL,
	"borrow_shares" numeric(78,0) NOT NULL,
	"borrow_assets_up" numeric(78,0) NOT NULL,
	"collateral_assets" numeric(78,0) NOT NULL,
	"collateral_value" numeric(78,0) NOT NULL,
	"ltv_wad" numeric(78,0),
	"morpho_health_wad" numeric(78,0),
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"provider_key" text NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "position_snapshots_account_market_block_unique" UNIQUE("crest_account_id","market_id","block_hash"),
	CONSTRAINT "position_snapshots_no_debt_null_health" CHECK ("position_snapshots"."borrow_assets_up" > 0 or ("position_snapshots"."ltv_wad" is null and "position_snapshots"."morpho_health_wad" is null))
);
--> statement-breakpoint
ALTER TABLE "position_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "postcondition_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"passed" boolean NOT NULL,
	"expected_json" jsonb NOT NULL,
	"actual_json" jsonb NOT NULL,
	"checked_block_number" numeric(78,0) NOT NULL,
	"checked_block_hash" "bytea" NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "postcondition_checks_run_kind_unique" UNIQUE("run_id","kind"),
	CONSTRAINT "postcondition_checks_kind_valid" CHECK ("postcondition_checks"."kind" in ('frozen','debt_decreased','reserve_floor_held','strategy_floor_held','vault_receiver_fixed','repay_beneficiary_fixed'))
);
--> statement-breakpoint
ALTER TABLE "postcondition_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"market_id" "bytea",
	"vault_deployment_id" uuid,
	"rate_value" numeric(78,0) NOT NULL,
	"rate_scale" numeric(78,0) NOT NULL,
	"period_kind" text NOT NULL,
	"gross_or_net" text NOT NULL,
	"source_url" text NOT NULL,
	"source_generated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "rate_observations_one_subject" CHECK (num_nonnulls("rate_observations"."market_id", "rate_observations"."vault_deployment_id") = 1),
	CONSTRAINT "rate_observations_scale_positive" CHECK ("rate_observations"."rate_scale" > 0)
);
--> statement-breakpoint
ALTER TABLE "rate_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "realized_strategy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"transaction_hash" "bytea" NOT NULL,
	"shares_before" numeric(78,0) NOT NULL,
	"shares_after" numeric(78,0) NOT NULL,
	"assets_before" numeric(78,0) NOT NULL,
	"assets_after" numeric(78,0) NOT NULL,
	"debt_before_assets" numeric(78,0) NOT NULL,
	"debt_after_assets" numeric(78,0) NOT NULL,
	"debt_repaid_assets" numeric(78,0) NOT NULL,
	"attributed_fees_assets" numeric(78,0),
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "realized_strategy_events_transaction_unique" UNIQUE("transaction_hash","kind"),
	CONSTRAINT "realized_strategy_events_kind_valid" CHECK ("realized_strategy_events"."kind" in ('deposit','withdraw','repay')),
	CONSTRAINT "realized_strategy_events_repay_reconciles" CHECK ("realized_strategy_events"."kind" <> 'repay' or ("realized_strategy_events"."debt_before_assets" > "realized_strategy_events"."debt_after_assets" and "realized_strategy_events"."debt_repaid_assets" = "realized_strategy_events"."debt_before_assets" - "realized_strategy_events"."debt_after_assets" and "realized_strategy_events"."debt_repaid_assets" > 0))
);
--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reserve_policies" (
	"policy_id" uuid PRIMARY KEY NOT NULL,
	"loan_token_id" uuid NOT NULL,
	"reserve_floor_assets" numeric(78,0) NOT NULL,
	"max_repay_per_action_assets" numeric(78,0) NOT NULL,
	CONSTRAINT "reserve_policies_repay_cap_positive" CHECK ("reserve_policies"."max_repay_per_action_assets" > 0)
);
--> statement-breakpoint
ALTER TABLE "reserve_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"account_snapshot_id" uuid,
	"position_snapshot_id" uuid,
	"strategy_position_snapshot_id" uuid,
	"market_snapshot_id" uuid,
	"vault_snapshot_id" uuid,
	"risk_engine_version" text NOT NULL,
	"status" text NOT NULL,
	"ltv_wad" numeric(78,0),
	"morpho_health_wad" numeric(78,0),
	"policy_health_wad" numeric(78,0),
	"owner_borrow_capacity_assets" numeric(78,0) NOT NULL,
	"repay_capacity_assets" numeric(78,0) NOT NULL,
	"estimated_annual_carry_assets" numeric(78,0) NOT NULL,
	"estimated_spread_bps" integer NOT NULL,
	"recommended_action" text NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"canonical_input_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	CONSTRAINT "risk_assessments_state_valid" CHECK ("risk_assessments"."status" in ('NORMAL','HARVESTABLE','UPSIZE_AVAILABLE','PROTECT','EXIT_YIELD','CRITICAL','DEGRADED')),
	CONSTRAINT "risk_assessments_action_valid" CHECK ("risk_assessments"."recommended_action" in ('none','owner_borrow','freeze','repay_reserve','repay_strategy','owner_review')),
	CONSTRAINT "risk_assessments_degraded_capacity_zero" CHECK ("risk_assessments"."status" <> 'DEGRADED' or "risk_assessments"."owner_borrow_capacity_assets" = 0)
);
--> statement-breakpoint
ALTER TABLE "risk_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "robinhood_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"provider_signal_id" text NOT NULL,
	"provider_generated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"validated_payload" jsonb NOT NULL,
	"payload_hash" "bytea" NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "robinhood_signals_provider_id_unique" UNIQUE("kind","provider_signal_id"),
	CONSTRAINT "robinhood_signals_kind_valid" CHECK ("robinhood_signals"."kind" in ('asset_status','underlying_price','halt','multiplier'))
);
--> statement-breakpoint
ALTER TABLE "robinhood_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scenario_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" text NOT NULL,
	"scenario_id" uuid NOT NULL,
	"stressed_collateral_value" numeric(78,0) NOT NULL,
	"stressed_debt_assets" numeric(78,0) NOT NULL,
	"stressed_vault_liquidity_assets" numeric(78,0) NOT NULL,
	"stressed_health_wad" numeric(78,0),
	"stressed_capacity_assets" numeric(78,0) NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "scenario_results_assessment_scenario_unique" UNIQUE("assessment_id","scenario_id")
);
--> statement-breakpoint
ALTER TABLE "scenario_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "strategy_policies" (
	"policy_id" uuid PRIMARY KEY NOT NULL,
	"max_strategy_assets" numeric(78,0) NOT NULL,
	"strategy_floor_assets" numeric(78,0) NOT NULL,
	"minimum_net_spread_bps" integer NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "strategy_policies_floor_bounded" CHECK ("strategy_policies"."strategy_floor_assets" <= "strategy_policies"."max_strategy_assets")
);
--> statement-breakpoint
ALTER TABLE "strategy_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "strategy_position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"vault_deployment_id" uuid NOT NULL,
	"share_balance" numeric(78,0) NOT NULL,
	"quoted_assets" numeric(78,0) NOT NULL,
	"max_withdrawable_assets" numeric(78,0) NOT NULL,
	"strategy_floor_assets" numeric(78,0) NOT NULL,
	"actionable_assets" numeric(78,0) NOT NULL,
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"provider_key" text NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "strategy_position_account_vault_block_unique" UNIQUE("crest_account_id","vault_deployment_id","block_hash"),
	CONSTRAINT "strategy_position_actionable_bounded" CHECK ("strategy_position_snapshots"."actionable_assets" <= "strategy_position_snapshots"."max_withdrawable_assets")
);
--> statement-breakpoint
ALTER TABLE "strategy_position_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stress_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"provenance" text NOT NULL,
	"status" text NOT NULL,
	"configuration" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stress_scenarios_status_valid" CHECK ("stress_scenarios"."status" in ('illustrative','calibrated'))
);
--> statement-breakpoint
ALTER TABLE "stress_scenarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "token_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" "bytea" NOT NULL,
	"decimals" smallint NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"source_url" text NOT NULL,
	"verified_block_number" numeric(78,0) NOT NULL,
	"verified_block_hash" "bytea" NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "token_deployments_chain_address_unique" UNIQUE("chain_id","address"),
	CONSTRAINT "token_deployments_id_asset_unique" UNIQUE("id","asset_id"),
	CONSTRAINT "token_deployments_address_length" CHECK (octet_length("token_deployments"."address") = 20),
	CONSTRAINT "token_deployments_code_hash_length" CHECK (octet_length("token_deployments"."code_hash") = 32),
	CONSTRAINT "token_deployments_decimals_range" CHECK ("token_deployments"."decimals" between 0 and 255)
);
--> statement-breakpoint
ALTER TABLE "token_deployments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transaction_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"chain_id" bigint NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"from_address" "bytea" NOT NULL,
	"to_address" "bytea" NOT NULL,
	"calldata_hash" "bytea" NOT NULL,
	"decoded_operation" text NOT NULL,
	"simulation_block_number" numeric(78,0) NOT NULL,
	"simulation_success" boolean NOT NULL,
	"simulation_gas" numeric(78,0),
	"nonce" numeric(78,0),
	"transaction_hash" "bytea",
	"submission_status" text NOT NULL,
	"error" text,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "transaction_attempts_run_number_unique" UNIQUE("run_id","attempt_number"),
	CONSTRAINT "transaction_attempts_operation_allowed" CHECK ("transaction_attempts"."decoded_operation" in ('freezeBorrowing()','repayFromReserve(uint256)','repayFromStrategy(uint256)')),
	CONSTRAINT "transaction_attempts_number_positive" CHECK ("transaction_attempts"."attempt_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "transaction_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transaction_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"canonical" boolean NOT NULL,
	"success" boolean NOT NULL,
	"revert_reason" text,
	"gas_used" numeric(78,0) NOT NULL,
	"decoded_events" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "transaction_receipts_attempt_unique" UNIQUE("attempt_id")
);
--> statement-breakpoint
ALTER TABLE "transaction_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" bigint NOT NULL,
	"address" "bytea" NOT NULL,
	"asset_token_id" uuid NOT NULL,
	"share_decimals" smallint NOT NULL,
	"interface_kind" text NOT NULL,
	"adapter_address" "bytea",
	"code_hash" "bytea" NOT NULL,
	"upgradeability_kind" text NOT NULL,
	"manager_json" jsonb NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"source_url" text NOT NULL,
	"verified_block_number" numeric(78,0) NOT NULL,
	"verified_block_hash" "bytea" NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "vault_deployments_chain_address_unique" UNIQUE("chain_id","address"),
	CONSTRAINT "vault_deployments_id_asset_unique" UNIQUE("id","asset_token_id"),
	CONSTRAINT "vault_deployments_address_length" CHECK (octet_length("vault_deployments"."address") = 20),
	CONSTRAINT "vault_deployments_adapter_length" CHECK ("vault_deployments"."adapter_address" is null or octet_length("vault_deployments"."adapter_address") = 20),
	CONSTRAINT "vault_deployments_code_hash_length" CHECK (octet_length("vault_deployments"."code_hash") = 32),
	CONSTRAINT "vault_deployments_interface_valid" CHECK ("vault_deployments"."interface_kind" in ('erc4626','fixed_adapter'))
);
--> statement-breakpoint
ALTER TABLE "vault_deployments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vault_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vault_deployment_id" uuid NOT NULL,
	"total_assets" numeric(78,0) NOT NULL,
	"total_supply_shares" numeric(78,0) NOT NULL,
	"max_deposit_assets" numeric(78,0) NOT NULL,
	"max_withdraw_assets" numeric(78,0) NOT NULL,
	"preview_redeem_assets" numeric(78,0) NOT NULL,
	"pause_status" text NOT NULL,
	"downstream_json" jsonb NOT NULL,
	"reason_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"provider_key" text NOT NULL,
	"reorged_at" timestamp with time zone,
	CONSTRAINT "vault_snapshots_vault_block_unique" UNIQUE("vault_deployment_id","block_hash")
);
--> statement-breakpoint
ALTER TABLE "vault_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_market_id_morpho_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."morpho_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_snapshots" ADD CONSTRAINT "account_snapshots_vault_deployment_id_vault_deployments_id_fk" FOREIGN KEY ("vault_deployment_id") REFERENCES "public"."vault_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_inputs" ADD CONSTRAINT "assessment_inputs_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."risk_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_intents" ADD CONSTRAINT "asset_intents_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_intents" ADD CONSTRAINT "asset_intents_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_intents" ADD CONSTRAINT "asset_intents_token_deployment_id_token_deployments_id_fk" FOREIGN KEY ("token_deployment_id") REFERENCES "public"."token_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_intents" ADD CONSTRAINT "asset_intents_market_id_morpho_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."morpho_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_intents" ADD CONSTRAINT "asset_intents_vault_deployment_id_vault_deployments_id_fk" FOREIGN KEY ("vault_deployment_id") REFERENCES "public"."vault_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_trigger_id_automation_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."automation_triggers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."risk_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corporate_actions" ADD CONSTRAINT "corporate_actions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crest_accounts" ADD CONSTRAINT "crest_accounts_chain_id_networks_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."networks"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crest_accounts" ADD CONSTRAINT "crest_accounts_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indexer_cursors" ADD CONSTRAINT "indexer_cursors_chain_id_networks_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."networks"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ltv_policies" ADD CONSTRAINT "ltv_policies_policy_lltv_fk" FOREIGN KEY ("policy_id","market_lltv_wad") REFERENCES "public"."policies"("id","market_lltv_wad") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_policies" ADD CONSTRAINT "market_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_market_id_morpho_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."morpho_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morpho_deployments" ADD CONSTRAINT "morpho_deployments_chain_id_networks_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."networks"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morpho_markets" ADD CONSTRAINT "morpho_markets_morpho_deployment_id_morpho_deployments_id_fk" FOREIGN KEY ("morpho_deployment_id") REFERENCES "public"."morpho_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morpho_markets" ADD CONSTRAINT "morpho_markets_loan_token_id_token_deployments_id_fk" FOREIGN KEY ("loan_token_id") REFERENCES "public"."token_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "morpho_markets" ADD CONSTRAINT "morpho_markets_collateral_token_id_token_deployments_id_fk" FOREIGN KEY ("collateral_token_id") REFERENCES "public"."token_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_market_route_fk" FOREIGN KEY ("market_id","loan_token_id","market_lltv_wad") REFERENCES "public"."morpho_markets"("id","loan_token_id","lltv_wad") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_vault_asset_fk" FOREIGN KEY ("vault_deployment_id","loan_token_id") REFERENCES "public"."vault_deployments"("id","asset_token_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_market_id_morpho_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."morpho_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postcondition_checks" ADD CONSTRAINT "postcondition_checks_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_observations" ADD CONSTRAINT "rate_observations_market_id_morpho_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."morpho_markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_observations" ADD CONSTRAINT "rate_observations_vault_deployment_id_vault_deployments_id_fk" FOREIGN KEY ("vault_deployment_id") REFERENCES "public"."vault_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ADD CONSTRAINT "realized_strategy_events_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_policies" ADD CONSTRAINT "reserve_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserve_policies" ADD CONSTRAINT "reserve_policies_loan_token_id_token_deployments_id_fk" FOREIGN KEY ("loan_token_id") REFERENCES "public"."token_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_account_snapshot_id_account_snapshots_id_fk" FOREIGN KEY ("account_snapshot_id") REFERENCES "public"."account_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_position_snapshot_id_position_snapshots_id_fk" FOREIGN KEY ("position_snapshot_id") REFERENCES "public"."position_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_strategy_position_snapshot_id_strategy_position_snapshots_id_fk" FOREIGN KEY ("strategy_position_snapshot_id") REFERENCES "public"."strategy_position_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_market_snapshot_id_market_snapshots_id_fk" FOREIGN KEY ("market_snapshot_id") REFERENCES "public"."market_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_vault_snapshot_id_vault_snapshots_id_fk" FOREIGN KEY ("vault_snapshot_id") REFERENCES "public"."vault_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robinhood_signals" ADD CONSTRAINT "robinhood_signals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."risk_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_results" ADD CONSTRAINT "scenario_results_scenario_id_stress_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."stress_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_policies" ADD CONSTRAINT "strategy_policies_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_position_snapshots" ADD CONSTRAINT "strategy_position_snapshots_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_position_snapshots" ADD CONSTRAINT "strategy_position_snapshots_vault_deployment_id_vault_deployments_id_fk" FOREIGN KEY ("vault_deployment_id") REFERENCES "public"."vault_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_deployments" ADD CONSTRAINT "token_deployments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_deployments" ADD CONSTRAINT "token_deployments_chain_id_networks_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."networks"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attempts" ADD CONSTRAINT "transaction_attempts_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attempts" ADD CONSTRAINT "transaction_attempts_chain_id_networks_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."networks"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_attempts" ADD CONSTRAINT "transaction_attempts_fixed_target_fk" FOREIGN KEY ("crest_account_id","to_address") REFERENCES "public"."crest_accounts"("id","address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_receipts" ADD CONSTRAINT "transaction_receipts_attempt_id_transaction_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."transaction_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_deployments" ADD CONSTRAINT "vault_deployments_chain_id_networks_chain_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."networks"("chain_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_deployments" ADD CONSTRAINT "vault_deployments_asset_token_id_token_deployments_id_fk" FOREIGN KEY ("asset_token_id") REFERENCES "public"."token_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_snapshots" ADD CONSTRAINT "vault_snapshots_vault_deployment_id_vault_deployments_id_fk" FOREIGN KEY ("vault_deployment_id") REFERENCES "public"."vault_deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_snapshots_account_id_idx" ON "account_snapshots" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "account_snapshots_market_id_idx" ON "account_snapshots" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "account_snapshots_vault_id_idx" ON "account_snapshots" USING btree ("vault_deployment_id");--> statement-breakpoint
CREATE INDEX "assessment_inputs_observation_id_idx" ON "assessment_inputs" USING btree ("observation_id");--> statement-breakpoint
CREATE INDEX "asset_intents_owner_id_idx" ON "asset_intents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "asset_intents_account_id_idx" ON "asset_intents" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "asset_intents_token_id_idx" ON "asset_intents" USING btree ("token_deployment_id");--> statement-breakpoint
CREATE INDEX "automation_triggers_assessment_id_idx" ON "automation_triggers" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "automation_triggers_policy_id_idx" ON "automation_triggers" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "corporate_actions_asset_id_idx" ON "corporate_actions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "crest_accounts_owner_id_idx" ON "crest_accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "crest_accounts_chain_id_idx" ON "crest_accounts" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "market_snapshots_market_id_idx" ON "market_snapshots" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "morpho_deployments_chain_id_idx" ON "morpho_deployments" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "morpho_markets_deployment_id_idx" ON "morpho_markets" USING btree ("morpho_deployment_id");--> statement-breakpoint
CREATE INDEX "morpho_markets_loan_token_id_idx" ON "morpho_markets" USING btree ("loan_token_id");--> statement-breakpoint
CREATE INDEX "morpho_markets_collateral_token_id_idx" ON "morpho_markets" USING btree ("collateral_token_id");--> statement-breakpoint
CREATE INDEX "policies_account_id_idx" ON "policies" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "policies_market_id_idx" ON "policies" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "policies_vault_id_idx" ON "policies" USING btree ("vault_deployment_id");--> statement-breakpoint
CREATE INDEX "position_snapshots_account_id_idx" ON "position_snapshots" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "position_snapshots_market_id_idx" ON "position_snapshots" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "postcondition_checks_run_id_idx" ON "postcondition_checks" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "rate_observations_market_id_idx" ON "rate_observations" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "rate_observations_vault_id_idx" ON "rate_observations" USING btree ("vault_deployment_id");--> statement-breakpoint
CREATE INDEX "realized_strategy_events_account_id_idx" ON "realized_strategy_events" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "risk_assessments_account_id_idx" ON "risk_assessments" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "risk_assessments_policy_id_idx" ON "risk_assessments" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "robinhood_signals_asset_id_idx" ON "robinhood_signals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "scenario_results_assessment_id_idx" ON "scenario_results" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "scenario_results_scenario_id_idx" ON "scenario_results" USING btree ("scenario_id");--> statement-breakpoint
CREATE INDEX "strategy_position_account_id_idx" ON "strategy_position_snapshots" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "strategy_position_vault_id_idx" ON "strategy_position_snapshots" USING btree ("vault_deployment_id");--> statement-breakpoint
CREATE INDEX "token_deployments_asset_id_idx" ON "token_deployments" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "token_deployments_chain_id_idx" ON "token_deployments" USING btree ("chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_attempts_hash_unique" ON "transaction_attempts" USING btree ("transaction_hash") WHERE "transaction_attempts"."transaction_hash" is not null;--> statement-breakpoint
CREATE INDEX "transaction_attempts_account_id_idx" ON "transaction_attempts" USING btree ("crest_account_id");--> statement-breakpoint
CREATE INDEX "vault_deployments_chain_id_idx" ON "vault_deployments" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "vault_deployments_asset_token_id_idx" ON "vault_deployments" USING btree ("asset_token_id");--> statement-breakpoint
CREATE INDEX "vault_snapshots_vault_deployment_id_idx" ON "vault_snapshots" USING btree ("vault_deployment_id");