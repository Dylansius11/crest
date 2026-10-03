import { Hono, type Context } from "hono";
import { BaseError } from "viem";

import {
  createRecordedAccountReader,
  parsePublicAddress,
  type AccountPositionResponse,
  type AccountRegistryResponse,
  type RecordedAccountReader,
} from "./accounts.ts";

import {
  createEnrollment,
  createEnrollmentChainReader,
  EnrollmentError,
  MAX_ENROLLMENT_BODY_BYTES,
  type Enrollment,
} from "./enrollment.ts";

import { createRobinhoodClient } from "@crest/chain";
import { createDatabase } from "@crest/db";

import { crestAccountAbi, GUARDIAN_SELECTORS } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { createPolicyDrafter, DraftError, type PolicyDrafter } from "./policy-draft.ts";

/**
 * Read-only API over reviewed, already-verified facts.
 *
 * Every response carries its evidence class and the block it was observed at. This service never signs,
 * never calls Guardian methods, and never derives a number the manifest or the ABI does not already prove.
 */

/** Where a response's numbers came from, so a client can never render reviewed evidence as live state. */
export type EvidenceClass = "reviewed-manifest" | "sandbox-manifest" | "forked" | "live";

export interface RouteResponse {
  evidence: EvidenceClass;
  /** A sandbox route always ships its disclosures; a client must show them beside any number. */
  trust: DeploymentManifest["trust"];
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

export type { AccountPositionResponse, AccountRegistryResponse, RecordedAccount, RecordedAccountReader } from "./accounts.ts";
export { EnrollmentError } from "./enrollment.ts";
export type { Enrollment, RegisterResponse, StagePolicyResponse } from "./enrollment.ts";

export interface CreateAppOptions {
  accounts?: RecordedAccountReader;
  enrollment?: Enrollment;
  policyDrafter?: PolicyDrafter;
}

/** The write surface accepts only a bounded, JSON envelope; nothing is parsed beyond the size guard. */
async function readEnrollmentBody(context: Context): Promise<unknown> {
  const raw = await context.req.text();
  if (raw.length > MAX_ENROLLMENT_BODY_BYTES) {
    throw new EnrollmentError(415, `request body exceeds ${MAX_ENROLLMENT_BODY_BYTES} bytes`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new EnrollmentError(400, "request body must be JSON");
  }
}

/** A refused enrollment is the truth; an unexpected failure is unreadable infrastructure, never a default. */
function enrollmentFailure(context: Context, error: unknown): Response {
  if (error instanceof EnrollmentError) return context.json({ error: error.message }, error.status);
  // viem's full message embeds the RPC URL, which can carry a provider key; its short message does not.
  // Drizzle wraps the driver error, so the cause carries the actual reason (for example a refused connection).
  const describe = (value: unknown) => value instanceof BaseError ? value.shortMessage : value instanceof Error ? value.message.split("\n")[0] : String(value);
  const cause = error instanceof Error && error.cause !== undefined ? `; cause: ${describe(error.cause)}` : "";
  console.error(`enrollment failed: ${describe(error)}${cause}`);
  return context.json({ error: "enrollment failed: chain or database is unreadable" }, 503);
}

function stateChangingSignatures(): string[] {
  return crestAccountAbi
    .filter((entry) => entry.type === "function" && entry.stateMutability !== "view" && entry.stateMutability !== "pure")
    .map((entry) => `${entry.name ?? ""}(${(entry.inputs ?? []).map((input) => input.type).join(",")})`)
    .sort();
}

export function createApp(manifest: DeploymentManifest, options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  const policyDrafter = options.policyDrafter ?? createPolicyDrafter(manifest, {
    provider: process.env.POLICY_LLM_PROVIDER ?? "disabled",
    key: process.env.POLICY_LLM_API_KEY ?? "",
  });

  app.post("/v1/policy/draft", async (context) => {
    try {
      const reader = context.req.raw.body?.getReader();
      if (!reader) throw new DraftError(400, "A JSON request body is required.");
      let raw = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 8192) {
          await reader.cancel();
          throw new DraftError(413, "Draft request exceeds 8192 bytes. Use the manual policy form.");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
      let body: unknown;
      try { body = JSON.parse(raw); }
      catch { throw new DraftError(400, "Draft request must be JSON."); }
      return context.json(await policyDrafter.draft(body));
    } catch (error) {
      if (error instanceof DraftError) return context.json({ error: error.message }, error.status);
      return context.json({ error: "Draft request is unreadable. Use the manual policy form." }, 400);
    }
  });
  app.get("/health", (context) => context.json({ status: "ok", service: "crest-api" }));

  app.get("/v1/route", (context) => {
    const body: RouteResponse = {
      evidence: manifest.trust.level === "sandbox" ? "sandbox-manifest" : "reviewed-manifest",
      trust: manifest.trust,
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

  app.get("/v1/accounts", async (context) => {
    const owner = context.req.query("owner");
    const address = owner ? parsePublicAddress(owner) : null;
    if (!address) return context.json({ error: "invalid owner address" }, 400);
    if (!options.accounts) return context.json({ error: "recorded account reader unavailable" }, 503);
    const body: AccountRegistryResponse = { evidence: "recorded", accounts: await options.accounts.listByOwner(address) };
    return context.json(body);
  });

  app.get("/v1/accounts/:address/position", async (context) => {
    const address = parsePublicAddress(context.req.param("address"));
    if (!address) return context.json({ error: "invalid account address" }, 400);
    if (!options.accounts) return context.json({ error: "recorded account reader unavailable" }, 503);
    const position: AccountPositionResponse | null = await options.accounts.positionByAddress(address);
    return position ? context.json(position) : context.json({ error: "account not found" }, 404);
  });

  // The only write surface. It registers a real owner-deployed account and stages a pending owner policy;
  // activation stays with the monitor's canonical PolicyConfigured proof, never with this request.
  app.post("/v1/accounts/register", async (context) => {
    if (!options.enrollment) return context.json({ error: "enrollment requires ROBINHOOD_CHAIN_RPC_URL" }, 503);
    try {
      const body = await readEnrollmentBody(context);
      return context.json(await options.enrollment.register(body), 200);
    } catch (error) {
      return enrollmentFailure(context, error);
    }
  });

  app.post("/v1/accounts/:address/policies", async (context) => {
    if (!options.enrollment) return context.json({ error: "enrollment requires ROBINHOOD_CHAIN_RPC_URL" }, 503);
    try {
      const body = await readEnrollmentBody(context);
      return context.json(await options.enrollment.stagePolicy(context.req.param("address"), body), 200);
    } catch (error) {
      return enrollmentFailure(context, error);
    }
  });

  app.notFound((context) => context.json({ error: "not found" }, 404));
  return app;
}

/** Fails closed: the reviewed manifest and recorded database must both be readable. */
export async function createAppFromManifest(): Promise<Hono> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const manifest = await loadDeploymentManifest();
  const { db } = createDatabase(databaseUrl);
  const options: CreateAppOptions = { accounts: createRecordedAccountReader(db, manifest) };
  // The read surface works without an RPC; the write surface fails closed until one is explicit.
  const rpcUrl = process.env.ROBINHOOD_CHAIN_RPC_URL;
  if (rpcUrl) {
    options.enrollment = createEnrollment({
      manifest,
      reader: createEnrollmentChainReader(createRobinhoodClient(rpcUrl, manifest.network.chainId)),
      db,
    });
  }
  return createApp(manifest, options);
}
