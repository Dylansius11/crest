import { eq } from "drizzle-orm";

import { canonicalJson } from "@crest/domain";

import type { createDatabase } from "./client.ts";
import { assessmentInputs, automationTriggers, riskAssessments } from "./schema.ts";

export type AssessmentRow = typeof riskAssessments.$inferInsert;
export type TriggerDraft = Pick<typeof automationTriggers.$inferInsert,
  "id" | "idempotencyKey" | "actionKind" | "requestedAssets" | "reasonCodes">;

/** The assessment and its one Guardian trigger share a transaction; replay never resets a claimed trigger. */
export async function persistAssessment(
  db: ReturnType<typeof createDatabase>["db"],
  assessment: AssessmentRow,
  trigger: TriggerDraft | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(riskAssessments).values(assessment).onConflictDoNothing().returning({ id: riskAssessments.id });
    if (!inserted) {
      const [prior] = await tx.select().from(riskAssessments).where(eq(riskAssessments.id, assessment.id));
      if (!prior || prior.crestAccountId !== assessment.crestAccountId || prior.policyId !== assessment.policyId ||
        canonicalJson(prior.inputJson) !== canonicalJson(assessment.inputJson) ||
        prior.accountSnapshotId !== (assessment.accountSnapshotId ?? null) ||
        prior.positionSnapshotId !== (assessment.positionSnapshotId ?? null) ||
        prior.strategyPositionSnapshotId !== (assessment.strategyPositionSnapshotId ?? null) ||
        prior.marketSnapshotId !== (assessment.marketSnapshotId ?? null) ||
        prior.vaultSnapshotId !== (assessment.vaultSnapshotId ?? null)) {
        throw new Error("assessment evidence changed on replay");
      }
    }
    if (inserted) {
      const refs = [
        ["account", assessment.accountSnapshotId],
        ["position", assessment.positionSnapshotId],
        ["strategy", assessment.strategyPositionSnapshotId],
        ["market", assessment.marketSnapshotId],
        ["vault", assessment.vaultSnapshotId],
      ] as const;
      const inputs = refs.flatMap(([inputKind, observationId]) =>
        observationId ? [{ assessmentId: assessment.id, inputKind, observationId, purpose: "risk_assessment" }] : []);
      if (inputs.length > 0) await tx.insert(assessmentInputs).values(inputs);
    }
    if (trigger) {
      const [created] = await tx.insert(automationTriggers).values({
        ...trigger,
        assessmentId: assessment.id,
        policyId: assessment.policyId,
        status: "detected",
        detectedAt: assessment.createdAt,
      }).onConflictDoNothing().returning({ id: automationTriggers.id });
      if (!created) {
        const [prior] = await tx.select().from(automationTriggers).where(eq(automationTriggers.idempotencyKey, trigger.idempotencyKey));
        if (!prior || prior.assessmentId !== assessment.id || prior.actionKind !== trigger.actionKind ||
          prior.requestedAssets !== (trigger.requestedAssets ?? null)) {
          throw new Error("trigger evidence changed on replay");
        }
      }
    }
  });
}
