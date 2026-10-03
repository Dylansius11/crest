import { describe, expect, test } from "vitest";
import { watchGuardian, type WatchDependencies, type WatchLog } from "./watch.ts";

function setup(overrides: Partial<WatchDependencies> = {}) {
  const events: string[] = [];
  const logs: WatchLog[] = [];
  let stopped = false;
  let signerLoads = 0;
  const dependencies: WatchDependencies = {
    authority: async () => { events.push("authority"); return true; },
    runs: async () => { events.push("runs"); return []; },
    reconcile: async (id) => { events.push(`reconcile:${id}`); return { status: "verified", runId: id }; },
    latestTrigger: async () => { events.push("latest"); return null; },
    execute: async (id) => { events.push(`execute:${id}`); signerLoads++; return { status: "verified", runId: id }; },
    heartbeat: async () => { events.push("heartbeat"); },
    log: (record) => logs.push(record),
    sleep: async () => { stopped = true; },
    stopped: () => stopped,
    intervalMs: 30_000,
    ...overrides,
  };
  return { dependencies, events, logs, signerLoads: () => signerLoads };
}

describe("Guardian watch", () => {
  test("reconciles every pending hash before selecting or signing a trigger", async () => {
    const example = setup({
      runs: async () => [{ runId: "a", status: "signed" }, { runId: "b", status: "broadcast" }],
      reconcile: async (id) => { example.events.push(`reconcile:${id}`); return { status: "pending", runId: id }; },
    });
    const status = await watchGuardian(example.dependencies);
    expect(status).toBe(0);
    expect(example.events).toEqual(["authority", "authority", "reconcile:a", "reconcile:b", "heartbeat"]);
    expect(example.logs).toEqual([{ service: "crest-guardian", result: "pending", runId: "b" }]);
  });

  test("finalizes a pending run before choosing the next eligible trigger", async () => {
    const example = setup({
      runs: async () => [{ runId: "old-run", status: "broadcast" }],
      reconcile: async (id) => { example.events.push(`reconcile:${id}`); return { status: "verified", runId: id }; },
      latestTrigger: async () => { example.events.push("latest"); return "new-trigger"; },
    });
    expect(await watchGuardian(example.dependencies)).toBe(0);
    expect(example.events).toEqual(["authority", "authority", "reconcile:old-run", "latest", "authority", "execute:new-trigger", "heartbeat"]);
    expect(example.signerLoads()).toBe(1);
  });

  test("an uncertain signed attempt halts selection and keeps reconciling on subsequent ticks", async () => {
    let ticks = 0;
    const example = setup({
      runs: async () => [{ runId: "unsafe", status: "reorg_conflict" }],
      reconcile: async () => { example.events.push("reconciled"); return { status: "uncertain", runId: "unsafe" }; },
      sleep: async () => { ticks++; }, stopped: () => ticks >= 2,
    });
    expect(await watchGuardian(example.dependencies)).toBe(0);
    expect(example.events.filter((event) => event === "reconciled")).toHaveLength(2);
    expect(example.events).not.toContain("latest");
    expect(example.logs).toEqual([
      { service: "crest-guardian", result: "halted_uncertain", runId: "unsafe", operatorInspectionRequired: true },
      { service: "crest-guardian", result: "halted_uncertain", runId: "unsafe", operatorInspectionRequired: true },
    ]);
  });

  test("a claimed run without durable hash blocks all new signing for operator inspection", async () => {
    const example = setup({
      runs: async () => [{ runId: "unknown-hash", status: "claimed" }],
      reconcile: async () => { throw new Error("claimed runs have no reliable hash to reconcile"); },
    });
    expect(await watchGuardian(example.dependencies)).toBe(0);
    expect(example.signerLoads()).toBe(0);
    expect(example.events).not.toContain("latest");
    expect(example.logs).toEqual([
      { service: "crest-guardian", result: "halted_uncertain", runId: "unknown-hash", operatorInspectionRequired: true },
    ]);
  });

  test("selects only the newest eligible trigger from the repository and executes it once", async () => {
    const example = setup({ latestTrigger: async () => { example.events.push("newest"); return "new-trigger"; } });
    expect(await watchGuardian(example.dependencies)).toBe(0);
    expect(example.events).toEqual(["authority", "authority", "runs", "newest", "authority", "execute:new-trigger", "heartbeat"]);
    expect(example.signerLoads()).toBe(1);
    expect(example.logs).toEqual([{ service: "crest-guardian", result: "verified", runId: "new-trigger" }]);
  });

  test("revoked guardian at startup exits nonzero before any key or trigger access", async () => {
    const example = setup({ authority: async () => false });
    expect(await watchGuardian(example.dependencies)).toBe(1);
    expect(example.events).toEqual([]);
    expect(example.signerLoads()).toBe(0);
    expect(example.logs).toEqual([{ service: "crest-guardian", result: "failed", error: "guardian_authority_failed" }]);
  });

  test("revocation while a hash is pending exits nonzero rather than idling indefinitely", async () => {
    let checks = 0;
    const example = setup({
      authority: async () => ++checks < 3,
      runs: async () => [{ runId: "pending-hash", status: "broadcast" }],
      reconcile: async () => ({ status: "pending", runId: "pending-hash" }),
      sleep: async () => {},
    });
    expect(await watchGuardian(example.dependencies)).toBe(1);
    expect(example.signerLoads()).toBe(0);
    expect(example.logs.at(-1)).toEqual({ service: "crest-guardian", result: "failed", error: "guardian_authority_failed" });
  });

  test("transient RPC errors are logged and the worker waits before the next tick", async () => {
    let ticks = 0;
    const example = setup({ runs: async () => {
      ticks++;
      if (ticks === 1) throw new Error("RPC unavailable");
      return [];
    }, stopped: () => ticks === 2, sleep: async () => { example.events.push("wait"); } });
    expect(await watchGuardian(example.dependencies)).toBe(0);
    expect(example.events).toEqual(["authority", "authority", "wait", "authority", "latest", "heartbeat"]);
    expect(example.logs.map((record) => record.result)).toEqual(["failed", "no_trigger"]);
  });

  test("SIGTERM requested during a tick finishes that tick and exits without sleeping", async () => {
    let stopped = false;
    const example = setup({
      runs: async () => { stopped = true; example.events.push("runs"); return []; },
      stopped: () => stopped,
    });
    expect(await watchGuardian(example.dependencies)).toBe(0);
    expect(example.events).toEqual(["authority", "authority", "runs", "latest", "heartbeat"]);
  });
});
