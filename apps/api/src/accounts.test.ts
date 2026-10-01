import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { loadDeploymentManifest } from "@crest/contracts/manifest/file";

import { createApp } from "./app.ts";
import type { AccountPositionResponse, RecordedAccountReader } from "./accounts.ts";

const manifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));
const owner = "0x1111111111111111111111111111111111111111";
const checksummedOwner = "0x52908400098527886E0F7030069857D2E4169EE7";
const lowercasedChecksummedOwner = checksummedOwner.toLowerCase();
const account = {
  address: "0x2222222222222222222222222222222222222222",
  chainId: "4663",
  codeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  policyNonce: "7",
  status: "active",
};

function appWith(reader: RecordedAccountReader) {
  return createApp(manifest, { accounts: reader });
}

describe("recorded account API", () => {
  test("rejects an address that is neither lowercase nor EIP-55", async () => {
    const app = appWith({
      listByOwner: async () => [],
      positionByAddress: async () => null,
    });

    const response = await app.request("/v1/accounts?owner=0x52908400098527886e0F7030069857D2E4169EE7");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid owner address" });
  });

  test("returns an empty registry for a valid owner with no recorded account", async () => {
    let requestedOwner: string | undefined;
    const app = appWith({
      listByOwner: async (value) => {
        requestedOwner = value;
        return value === owner ? [account] : [];
      },
      positionByAddress: async () => null,
    });

    const response = await app.request(`/v1/accounts?owner=${checksummedOwner}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ evidence: "recorded", accounts: [] });
    expect(requestedOwner).toBe(lowercasedChecksummedOwner);
  });

  test("returns not found for an address absent from the recorded registry", async () => {
    const app = appWith({
      listByOwner: async () => [],
      positionByAddress: async () => null,
    });

    const response = await app.request(`/v1/accounts/${account.address}/position`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "account not found" });
  });

  test("returns the latest canonical snapshot only with its same-block assessment", async () => {
    const responseBody: AccountPositionResponse = {
      evidence: "recorded",
      account,
      snapshot: {
        blockNumber: "70226651",
        blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        observedAt: "2026-09-30T12:00:00.000Z",
        owner,
        guardian: "0x3333333333333333333333333333333333333333",
        frozen: false,
        collateralAssets: "1000000",
        debtAssets: "500000",
        reserveAssets: "20000",
        vaultShares: "300000",
        quotedVaultAssets: "300100",
        withdrawableVaultAssets: "250000",
      },
      assessment: {
        status: "NORMAL",
        reasonCodes: [],
        ownerBorrowCapacityAssets: "100000",
        projectedCarryAssets: null,
        projectedSpreadBps: null,
      },
      realizedDebtRepaidAssets: null,
    };
    const app = appWith({
      listByOwner: async () => [account],
      positionByAddress: async () => responseBody,
    });

    const response = await app.request(`/v1/accounts/${account.address}/position`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(responseBody);
  });
});
