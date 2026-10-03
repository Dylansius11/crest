import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { getAddress } from "viem";
import type { Address } from "viem";
import { afterAll, describe, expect, test } from "vitest";

import { computeManifestIntegrity } from "@crest/contracts/manifest";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase } from "@crest/db";
import { marketIdOf } from "@crest/morpho";

import { registerManifestRoute, RouteRegistryConflict } from "./route-registry.ts";

// Integration fixtures only run against an explicitly chosen disposable database.
const integrationDatabaseUrl = process.env.API_INTEGRATION_DATABASE_URL;
const { client, db } = createDatabase(integrationDatabaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused");
const sandbox = await loadDeploymentManifest(
  fileURLToPath(new URL("../../../config/deployment-manifest.46630.json", import.meta.url)),
);
const [morpho, loan, collateral, vault] = Array.from(
  { length: 4 },
  () => getAddress(`0x${randomBytes(20).toString("hex")}`),
) as [Address, Address, Address, Address];
const marketId = marketIdOf({
  loanToken: loan, collateralToken: collateral, oracle: getAddress(sandbox.market.oracle), irm: getAddress(sandbox.market.irm),
  lltv: BigInt(sandbox.market.lltv),
});

function sealed(manifest: Omit<DeploymentManifest, "integrity">): DeploymentManifest {
  return { ...manifest, integrity: { algorithm: "sha256", digest: computeManifestIntegrity(manifest) } };
}

function rebound(contracts: DeploymentManifest["contracts"], key: string, patch: { address?: string; codeHash?: string }) {
  const evidence = contracts[key];
  if (evidence === undefined) throw new Error(`fixture manifest has no ${key}`);
  return { ...contracts, [key]: { ...evidence, ...patch } };
}

const manifest = sealed({
  ...sandbox,
  contracts: ([["morpho", morpho], ["loanToken", loan], ["collateralToken", collateral], ["vault", vault]] as const)
    .reduce<DeploymentManifest["contracts"]>((all, [key, address]) => rebound(all, key, { address }), sandbox.contracts),
  market: { ...sandbox.market, id: marketId, derivedId: marketId, loanToken: loan, collateralToken: collateral },
  vault: { ...sandbox.vault, address: vault, asset: loan },
});
const bytes = (value: string) => Buffer.from(value.slice(2), "hex");

(integrationDatabaseUrl ? describe : describe.skip)("manifest route registration", () => {
  afterAll(async () => {
    const tokens = await client`select id, asset_id from token_deployments where address in (${bytes(loan)}, ${bytes(collateral)})`;
    await client`delete from vault_deployments where address = ${bytes(vault)}`;
    await client`delete from morpho_markets where id = ${bytes(marketId)}`;
    await client`delete from morpho_deployments where address = ${bytes(morpho)}`;
    await client`delete from token_deployments where address in (${bytes(loan)}, ${bytes(collateral)})`;
    for (const token of tokens) await client`delete from assets where id = ${token.asset_id}`;
    await client.end();
  });

  test("records a sandbox route as degraded and adds nothing when registered again", async () => {
    const first = await registerManifestRoute(db, manifest);
    expect(first.inserted).toBeGreaterThanOrEqual(6);
    const [market] = await client`select status, status_reason_codes from morpho_markets where id = ${bytes(marketId)}`;
    const [stored] = await client`select status, reason_codes from vault_deployments where address = ${bytes(vault)}`;
    expect(market).toMatchObject({ status: "degraded", status_reason_codes: ["sandbox_route"] });
    expect(stored).toMatchObject({ status: "degraded", reason_codes: ["sandbox_route"] });

    const again = await registerManifestRoute(db, manifest);
    expect(again.inserted).toBe(0);
  });

  test("refuses a manifest whose vault code differs from the registered row and leaves the row untouched", async () => {
    const codeHash = `0x${"ee".repeat(32)}`;
    const drifted = sealed({ ...manifest, contracts: rebound(manifest.contracts, "vault", { codeHash }),
      vault: { ...manifest.vault, codeHash } });
    await expect(registerManifestRoute(db, drifted)).rejects.toThrow(/vault 0x[0-9a-fA-F]{40} is already registered with different codeHash/);
    const [stored] = await client`select encode(code_hash, 'hex') as code from vault_deployments where address = ${bytes(vault)}`;
    expect(`0x${stored?.code}`).toBe(manifest.vault.codeHash.toLowerCase());
  });
});
