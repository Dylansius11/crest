CREATE UNIQUE INDEX "automation_runs_in_flight_guardian_unique" ON "automation_runs" USING btree ("guardian_address") WHERE "automation_runs"."status" IN ('claimed', 'signed', 'broadcast');
--> statement-breakpoint
ALTER TABLE "transaction_attempts" ADD COLUMN "simulation_block_hash" bytea;
--> statement-breakpoint
ALTER TABLE "transaction_attempts" ADD CONSTRAINT "transaction_attempts_simulation_hash_present" CHECK ("simulation_block_hash" IS NOT NULL) NOT VALID;
