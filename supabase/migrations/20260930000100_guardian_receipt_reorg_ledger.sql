ALTER TABLE "transaction_receipts" DROP CONSTRAINT "transaction_receipts_attempt_unique";
--> statement-breakpoint
ALTER TABLE "transaction_receipts" ADD CONSTRAINT "transaction_receipts_attempt_block_unique" UNIQUE("attempt_id","block_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_receipts_attempt_canonical_unique" ON "transaction_receipts" USING btree ("attempt_id") WHERE "canonical";
--> statement-breakpoint
ALTER TABLE "postcondition_checks" DROP CONSTRAINT "postcondition_checks_run_kind_unique";
--> statement-breakpoint
ALTER TABLE "postcondition_checks" ADD CONSTRAINT "postcondition_checks_run_kind_block_unique" UNIQUE("run_id","kind","checked_block_hash");
