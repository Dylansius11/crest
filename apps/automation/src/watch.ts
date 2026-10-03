export interface WatchRun {
  runId: string;
  status: string;
}

export interface WatchResult {
  status: "no_trigger" | "pending" | "verified" | "failed" | "uncertain";
  runId?: string;
  transactionHash?: `0x${string}`;
}

export interface WatchLog {
  service: "crest-guardian";
  result: "no_trigger" | "pending" | "verified" | "failed" | "halted_uncertain";
  runId?: string;
  txHash?: `0x${string}`;
  operatorInspectionRequired?: true;
  error?: string;
}

export interface WatchDependencies {
  authority(): Promise<boolean>;
  runs(): Promise<WatchRun[]>;
  reconcile(runId: string): Promise<WatchResult | null>;
  latestTrigger(): Promise<string | null>;
  execute(triggerId: string): Promise<WatchResult>;
  heartbeat(): Promise<void>;
  log(record: WatchLog): void;
  sleep(intervalMs: number): Promise<void>;
  stopped(): boolean;
  intervalMs: number;
}

/** One signer, one bounded action per tick. A signed unknown is never re-sent. */
export async function watchGuardian(deps: WatchDependencies): Promise<number> {
  if (!await deps.authority()) {
    deps.log({ service: "crest-guardian", result: "failed", error: "guardian_authority_failed" });
    return 1;
  }
  while (!deps.stopped()) {
    let record: WatchLog = { service: "crest-guardian", result: "no_trigger" };
    try {
      if (!await deps.authority()) {
        deps.log({ service: "crest-guardian", result: "failed", error: "guardian_authority_failed" });
        return 1;
      }
      const runs = await deps.runs();
      let pending = false;
      let uncertain = false;
      for (const run of runs) {
        const result = run.status === "claimed" ? null : await deps.reconcile(run.runId);
        if (result?.status === "verified" || result?.status === "failed") {
          if (!uncertain && !pending) record = { service: "crest-guardian", result: result.status, runId: run.runId,
            ...(result.transactionHash ? { txHash: result.transactionHash } : {}) };
        } else if (run.status === "claimed" || run.status === "reorg_conflict" || !result || result.status === "uncertain") {
          uncertain = true;
          record = { service: "crest-guardian", result: "halted_uncertain", runId: run.runId,
            ...(result?.transactionHash ? { txHash: result.transactionHash } : {}), operatorInspectionRequired: true };
        } else {
          pending = true;
          if (!uncertain) record = { service: "crest-guardian", result: "pending", runId: run.runId,
            ...(result.transactionHash ? { txHash: result.transactionHash } : {}) };
        }
      }
      if (!pending && !uncertain) {
        const triggerId = await deps.latestTrigger();
        if (triggerId) {
          if (!await deps.authority()) {
            deps.log({ service: "crest-guardian", result: "failed", error: "guardian_authority_failed" });
            return 1;
          }
          const result = await deps.execute(triggerId);
          record = { service: "crest-guardian", result: result.status === "uncertain" ? "halted_uncertain" : result.status,
            ...(result.runId ? { runId: result.runId } : {}),
            ...(result.transactionHash ? { txHash: result.transactionHash } : {}),
            ...(result.status === "uncertain" ? { operatorInspectionRequired: true } : {}) };
        }
      }
      await deps.heartbeat();
    } catch {
      record = { service: "crest-guardian", result: "failed", error: "tick_unavailable" };
    }
    deps.log(record);
    if (!deps.stopped()) await deps.sleep(deps.intervalMs);
  }
  return 0;
}
