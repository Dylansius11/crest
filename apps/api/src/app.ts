import { Hono } from "hono";

import { crestAccountAbi, GUARDIAN_SELECTORS } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import type { DeploymentManifest } from "@crest/contracts/manifest";

/**
 * Read-only API over reviewed, already-verified facts.
 *
 * Every response carries its evidence class and the block it was observed at. This service never signs,
 * never calls Guardian methods, and never derives a number the manifest or the ABI does not already prove.
 */

/** Where a response's numbers came from, so a client can never render reviewed evidence as live state. */
export type EvidenceClass = "reviewed-manifest" | "forked" | "live";

export interface RouteResponse {
  evidence: EvidenceClass;
  chainId: number;
  gate: DeploymentManifest["gate"];
  observedAt: { blockNumber: string; blockHash: string; timestamp: string; finality: string };
  forkProof: DeploymentManifest["forkProof"];
  market: {
    id: string;
    loanToken: string;
    collateralToken: string;
    oracle: string;
    irm: string;
    lltv: string;
    liquidityAssets: string;
  };
  vault: {
    address: string;
    asset: string;
    generation: string;
    withdrawableAssets: string;
    maxFunctions: Record<string, string>;
  };
  integrity: DeploymentManifest["integrity"];
}

export interface AuthorityResponse {
  evidence: "compiled-abi";
  /** Selectors the Guardian may call. The contract enforces this set; the API only reports it. */
  guardian: readonly string[];
  /** Everything else that changes state is owner-only, listed so a reviewer can diff the surface. */
  stateChanging: string[];
}

function stateChangingSignatures(): string[] {
  return crestAccountAbi
    .filter((entry) => entry.type === "function" && entry.stateMutability !== "view" && entry.stateMutability !== "pure")
    .map((entry) => `${entry.name ?? ""}(${(entry.inputs ?? []).map((input) => input.type).join(",")})`)
    .sort();
}

export function createApp(manifest: DeploymentManifest): Hono {
  const app = new Hono();

  app.get("/health", (context) => context.json({ status: "ok", service: "crest-api" }));

  app.get("/v1/route", (context) => {
    const body: RouteResponse = {
      evidence: "reviewed-manifest",
      chainId: manifest.network.chainId,
      gate: manifest.gate,
      observedAt: {
        blockNumber: manifest.evidence.block.number,
        blockHash: manifest.evidence.block.hash,
        timestamp: manifest.evidence.block.timestamp,
        finality: manifest.evidence.block.finality,
      },
      forkProof: manifest.forkProof,
      market: {
        id: manifest.market.id,
        loanToken: manifest.market.loanToken,
        collateralToken: manifest.market.collateralToken,
        oracle: manifest.market.oracle,
        irm: manifest.market.irm,
        lltv: manifest.market.lltv,
        liquidityAssets: manifest.market.liquidityAssets,
      },
      vault: {
        address: manifest.vault.address,
        asset: manifest.vault.asset,
        generation: manifest.vault.generation,
        withdrawableAssets: manifest.vault.withdrawableAssets,
        maxFunctions: manifest.vault.maxFunctions,
      },
      integrity: manifest.integrity,
    };
    return context.json(body);
  });

  app.get("/v1/authority", (context) => {
    const body: AuthorityResponse = {
      evidence: "compiled-abi",
      guardian: GUARDIAN_SELECTORS,
      stateChanging: stateChangingSignatures(),
    };
    return context.json(body);
  });

  app.notFound((context) => context.json({ error: "not found" }, 404));
  return app;
}

/** Fails closed: an unreadable or invalid manifest must stop the service, never degrade it. */
export async function createAppFromManifest(): Promise<Hono> {
  return createApp(await loadDeploymentManifest());
}
