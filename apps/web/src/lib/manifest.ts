import { isDeploymentManifest, validateDeploymentManifest } from "@crest/contracts/manifest";
import type { DeploymentManifest } from "@crest/contracts/manifest";

import raw from "../../../../config/deployment-manifest.json";

/**
 * The reviewed route, bound at build time.
 *
 * The manifest describes evidence that only changes through review, so the app compiles it in rather than
 * reading it at request time. Validation runs here: a build can never ship a web app that renders an
 * unreviewed or tampered route.
 */

const errors = validateDeploymentManifest(raw);
if (errors.length > 0 || !isDeploymentManifest(raw)) {
  throw new Error(`invalid deployment manifest:\n${errors.join("\n")}`);
}

export const reviewedManifest: DeploymentManifest = raw;
