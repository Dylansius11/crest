import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const script = fileURLToPath(new URL("./main.ts", import.meta.url));
const cwd = fileURLToPath(new URL("..", import.meta.url));

describe("Custos command gate", () => {
  test("a run without explicit route, signer and database settings exits before any RPC or signature", () => {
    const result = spawnSync(process.execPath, [script, "run", "--once", "--trigger-id", "0x01"], {
      cwd, encoding: "utf8", env: { ...process.env, ROBINHOOD_CHAIN_RPC_URL: "", DATABASE_URL: "",
        GUARDIAN_EXPECTED_ADDRESS: "", GUARDIAN_ALLOWED_ACCOUNT: "", GUARDIAN_PRIVATE_KEY: "" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ROBINHOOD_CHAIN_RPC_URL");
    expect(result.stderr).not.toContain("usage: crest-guardian doctor");
  }, 30_000);
});

test("reconcile requires an explicit run ID and never requires the signer key", () => {
  const result = spawnSync(process.execPath, [script, "reconcile"], {
    cwd, encoding: "utf8", env: { ...process.env, GUARDIAN_PRIVATE_KEY: "" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("--run-id");
  expect(result.stderr).not.toContain("GUARDIAN_PRIVATE_KEY");
}, 30_000);

test("run rejects absent explicit expected chain before network access", () => {
  const result = spawnSync(process.execPath, [script, "run", "--once", "--trigger-id", "0x01"], {
    cwd, encoding: "utf8", env: { ...process.env, ROBINHOOD_CHAIN_RPC_URL: "https://example.invalid",
      DATABASE_URL: "postgresql://example.invalid/db", GUARDIAN_EXPECTED_CHAIN_ID: "",
      GUARDIAN_EXPECTED_ADDRESS: "0x1111111111111111111111111111111111111111",
      GUARDIAN_ALLOWED_ACCOUNT: "0x2222222222222222222222222222222222222222", GUARDIAN_PRIVATE_KEY: "0x01" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("GUARDIAN_EXPECTED_CHAIN_ID");
  expect(result.stderr).not.toContain("example.invalid");
}, 30_000);

test("doctor cannot attest an unregistered account without database evidence", () => {
  const result = spawnSync(process.execPath, [script, "doctor"], {
    cwd, encoding: "utf8", env: { ...process.env, ROBINHOOD_CHAIN_RPC_URL: "https://example.invalid",
      DATABASE_URL: "", GUARDIAN_EXPECTED_ADDRESS: "0x1111111111111111111111111111111111111111",
      GUARDIAN_ALLOWED_ACCOUNT: "0x2222222222222222222222222222222222222222" },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("DATABASE_URL");
  expect(result.stderr).not.toContain("example.invalid");
}, 30_000);
