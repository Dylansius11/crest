import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { GUARDIAN_SELECTORS } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";

import { createApp } from "./app.ts";
import type { AuthorityResponse, RouteResponse } from "./app.ts";

const manifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));
const app = createApp(manifest);

describe("read-only route API", () => {
  test("labels the route as reviewed manifest evidence with its observation block", async () => {
    const response = await app.request("/v1/route");
    const body = (await response.json()) as RouteResponse;

    expect(response.status).toBe(200);
    expect(body.evidence).toBe("reviewed-manifest");
    expect(body.observedAt.blockNumber).toBe(manifest.evidence.block.number);
    expect(body.observedAt.finality).toBe("finalized");
    expect(body.chainId).toBe(4663);
  });

  test("labels the testnet route as sandbox evidence and ships its disclosures", async () => {
    const sandbox = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.46630.json", import.meta.url)));
    const body = (await (await createApp(sandbox).request("/v1/route")).json()) as RouteResponse;

    expect(body.evidence).toBe("sandbox-manifest");
    expect(body.chainId).toBe(46630);
    expect(body.trust.disclosures).toEqual(sandbox.trust.disclosures);
  });

  test("reports the Guardian surface as exactly the three bounded selectors", async () => {
    const response = await app.request("/v1/authority");
    const body = (await response.json()) as AuthorityResponse;

    expect(body.guardian).toEqual([...GUARDIAN_SELECTORS]);
    expect(body.guardian.map((signature) => signature.split("(")[0]).sort()).toEqual([
      "freezeBorrowing",
      "repayFromReserve",
      "repayFromStrategy",
    ]);
  });

  test("never exposes a state-changing signature outside the reviewed surface", async () => {
    const response = await app.request("/v1/authority");
    const body = (await response.json()) as AuthorityResponse;

    for (const signature of body.stateChanging) {
      expect(signature).not.toMatch(/^(execute|delegate|upgrade|sweep|multicall)/i);
    }
    expect(body.stateChanging).toContain("borrowAndDeploy(uint256,uint256)");
  });
});
