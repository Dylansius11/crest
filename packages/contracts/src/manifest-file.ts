import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isDeploymentManifest, validateDeploymentManifest } from "./manifest.ts";
import type { DeploymentManifest } from "./manifest.ts";

/**
 * Reads and validates the reviewed manifest, defaulting to `DEPLOYMENT_MANIFEST_PATH`. Throws when it is
 * missing or fails any offline rule, so a caller can never serve, render, or act on an unreviewed route.
 */
export async function loadDeploymentManifest(
  path = resolve(process.env.DEPLOYMENT_MANIFEST_PATH ?? "config/deployment-manifest.json"),
): Promise<DeploymentManifest> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const errors = validateDeploymentManifest(raw);
  if (errors.length > 0 || !isDeploymentManifest(raw)) {
    throw new Error(`invalid deployment manifest at ${path}:\n${errors.join("\n")}`);
  }
  return raw;
}
