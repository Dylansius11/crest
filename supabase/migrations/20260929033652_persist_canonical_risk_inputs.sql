CREATE TABLE "canonical_account_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crest_account_id" uuid NOT NULL,
	"event_kind" text NOT NULL,
	"transaction_hash" "bytea" NOT NULL,
	"log_index" numeric(78,0) NOT NULL,
	"block_number" numeric(78,0) NOT NULL,
	"block_hash" "bytea" NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"canonical" boolean DEFAULT true NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"reorged_at" timestamp with time zone,
	"payload_json" jsonb NOT NULL,
	CONSTRAINT "canonical_account_events_account_transaction_log_block_unique" UNIQUE("crest_account_id","transaction_hash","log_index","block_hash")
);
--> statement-breakpoint
ALTER TABLE "canonical_account_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_observations_market_replay_unique" ON "rate_observations" USING btree ("subject_kind","market_id","source_url","fetched_at","period_kind") WHERE "rate_observations"."market_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_observations_vault_replay_unique" ON "rate_observations" USING btree ("subject_kind","vault_deployment_id","source_url","fetched_at","period_kind") WHERE "rate_observations"."vault_deployment_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "market_snapshots" ALTER COLUMN "oracle_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_snapshots" ALTER COLUMN "preview_redeem_assets" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_snapshots" ALTER COLUMN "max_deposit_assets" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vault_snapshots" ALTER COLUMN "max_withdraw_assets" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_snapshots" ALTER COLUMN "collateral_token_balance" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_snapshots" ALTER COLUMN "vault_share_balance" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "position_snapshots" ALTER COLUMN "collateral_value" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_assessments" ALTER COLUMN "estimated_annual_carry_assets" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_assessments" ALTER COLUMN "estimated_spread_bps" SET DATA TYPE numeric(78,0) USING "estimated_spread_bps"::numeric(78,0);--> statement-breakpoint
ALTER TABLE "risk_assessments" ALTER COLUMN "estimated_spread_bps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD COLUMN "input_json" jsonb;--> statement-breakpoint
UPDATE "risk_assessments" SET "input_json" = '{}'::jsonb WHERE "input_json" IS NULL;--> statement-breakpoint
ALTER TABLE "risk_assessments" ALTER COLUMN "input_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "policy_hash" bytea;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_policy_hash_length" CHECK ("policies"."policy_hash" is null or octet_length("policies"."policy_hash") = 32);--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ALTER COLUMN "shares_before" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ALTER COLUMN "shares_after" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ADD COLUMN "log_index" numeric(78,0);--> statement-breakpoint
WITH numbered_events AS (
  SELECT "id", (row_number() OVER (PARTITION BY "crest_account_id", "transaction_hash" ORDER BY "kind", "id") - 1)::numeric(78,0) AS "log_index"
  FROM "realized_strategy_events"
)
UPDATE "realized_strategy_events" AS "events"
SET "log_index" = "numbered_events"."log_index"
FROM numbered_events
WHERE "events"."id" = "numbered_events"."id";--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ALTER COLUMN "log_index" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "realized_strategy_events" DROP CONSTRAINT "realized_strategy_events_transaction_unique";--> statement-breakpoint
ALTER TABLE "realized_strategy_events" ADD CONSTRAINT "realized_strategy_events_account_transaction_log_block_unique" UNIQUE("crest_account_id","transaction_hash","log_index","block_hash");--> statement-breakpoint
ALTER TABLE "canonical_account_events" ADD CONSTRAINT "canonical_account_events_crest_account_id_crest_accounts_id_fk" FOREIGN KEY ("crest_account_id") REFERENCES "public"."crest_accounts"("id") ON DELETE no action ON UPDATE no action;