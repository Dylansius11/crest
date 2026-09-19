import { fileURLToPath } from "node:url";

import { keccak256, toHex } from "viem";
import type { Address, Hex } from "viem";
import { describe, expect, test } from "vitest";

import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import type { DeploymentManifest } from "@crest/contracts/manifest";

import { observeRoute } from "./observe.ts";
import type { RouteReader } from "./observe.ts";

const manifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));

/** Bytecode whose keccak256 equals the manifest's recorded hash for every reviewed address. */
function matchingCode(target: DeploymentManifest): Record<string, Hex> {
  const byAddress: Record<string, Hex> = {};
  let counter = 0;
  const codeFor = (address: string): Hex => {
    const key = address.toLowerCase();
    const existing = byAddress[key];
    if (existing) return existing;
    const code = toHex(`code-${(counter += 1)}`);
    byAddress[key] = code;
    return code;
  };

  for (const evidence of Object.values(target.contracts)) evidence.codeHash = keccak256(codeFor(evidence.address));
  target.vault.codeHash = keccak256(codeFor(target.vault.address));
  return byAddress;
}

function reader(target: DeploymentManifest, overrides: Partial<RouteReader> = {}): RouteReader {
  const code = matchingCode(target);
  return {
    getChainId: async () => target.network.chainId,
    getBlock: async () => ({ number: 100n, hash: `0x${"ab".repeat(32)}` as Hex, timestamp: 1_700_000_000n }),
    getCode: async (address: Address) => code[address.toLowerCase()],
    readVaultAsset: async () => target.vault.asset as Address,
    ...overrides,
  };
}

describe("route drift observation", () => {
  test("reports matched only when every identity still resolves to the reviewed value", async () => {
    const target = structuredClone(manifest);
    const observation = await observeRoute(target, reader(target));

    expect(observation.status).toBe("matched");
    expect(observation.block.number).toBe("100");
    expect(observation.chainId).toBe(4663);
    expect(observation.checks.filter((check) => check.status !== "matched")).toEqual([]);
  });

  test("redeployed bytecode at a reviewed address is drift, naming the check", async () => {
    const target = structuredClone(manifest);
    const base = reader(target);
    const observation = await observeRoute(target, {
      ...base,
      getCode: async (address: Address) => (address.toLowerCase() === target.vault.address.toLowerCase() ? toHex("other") : base.getCode(address, 100n)),
    });

    expect(observation.status).toBe("drifted");
    expect(observation.checks.find((check) => check.name === "vault.codeHash")?.status).toBe("drifted");
  });

  test("an unreadable address degrades to drift instead of passing silently", async () => {
    const target = structuredClone(manifest);
    const base = reader(target);
    const observation = await observeRoute(target, { ...base, getCode: async () => undefined });

    expect(observation.status).toBe("drifted");
    expect(observation.checks.filter((check) => check.status === "unreadable").length).toBeGreaterThan(0);
  });

  test("a vault whose asset moved off the market loan token is drift", async () => {
    const target = structuredClone(manifest);
    const observation = await observeRoute(target, {
      ...reader(target),
      readVaultAsset: async () => "0x0000000000000000000000000000000000000009" as Address,
    });

    expect(observation.checks.find((check) => check.name === "vault.asset")?.status).toBe("drifted");
    expect(observation.status).toBe("drifted");
  });

  test("a wrong chain can never be reported as a matched route", async () => {
    const target = structuredClone(manifest);
    const observation = await observeRoute(target, { ...reader(target), getChainId: async () => 1 });

    expect(observation.status).toBe("drifted");
  });
});
