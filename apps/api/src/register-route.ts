import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase } from "@crest/db";

import { registerManifestRoute } from "./route-registry.ts";

/** Operator step: record the active manifest route before any owner enrolls on it. Safe to repeat. */
const localEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const manifest = await loadDeploymentManifest();
const { client, db } = createDatabase(databaseUrl);
try {
  const route = await registerManifestRoute(db, manifest);
  console.log(`route registered: chain ${route.chainId} (${route.trust}) market ${route.marketId} vault ${route.vault}; ${route.inserted} new rows`);
} finally {
  await client.end();
}
