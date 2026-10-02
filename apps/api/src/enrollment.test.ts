import { fileURLToPath } from "node:url";

import type { SQL } from "drizzle-orm";
import { encodeDeployData, getAddress, keccak256, recoverMessageAddress } from "viem";
import type { Abi, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";

import { crestAccountAbi, crestAccountCreationBytecode } from "@crest/contracts";
import { isRecord } from "@crest/contracts/manifest";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { compilePolicy, policyStagingMessage, routeContextOf } from "@crest/policy";

import { createApp } from "./app.ts";
import { createEnrollment } from "./enrollment.ts";
import type { EnrollmentBlockHashReader, EnrollmentDatabase } from "./enrollment.ts";

const manifest = await loadDeploymentManifest(
  fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)),
);
const chainId = manifest.network.chainId;
const morpho = getAddress(manifest.contracts.morpho?.address ?? "");
const ownerSigner = privateKeyToAccount(`0x${"44".repeat(32)}`);
const owner = ownerSigner.address;
const otherOwner = getAddress("0x9999999999999999999999999999999999999999");
const account = getAddress("0x2222222222222222222222222222222222222222");
const otherAccount = getAddress("0x8888888888888888888888888888888888888888");
const guardian = getAddress("0x3333333333333333333333333333333333333333");
const blockHash = `0x${"ab".repeat(32)}` as Hex;
const otherBlockHash = `0x${"ef".repeat(32)}` as Hex;
const transactionHash = `0x${"cd".repeat(32)}` as Hex;
const code = "0x6001600155" as Hex;
const codeHash = keccak256(code);
const receiptBlock = 150n;
const finalized = 200n;

const deploymentInput = encodeDeployData({
  abi: crestAccountAbi as Abi,
  bytecode: crestAccountCreationBytecode,
  args: [owner, morpho],
});

const lltv = BigInt(manifest.market.lltv);
const draft = {
  schemaVersion: 2,
  maxCollateralAssets: "10000000000000000000",
  debtCeilingAssets: "1500000000",
  maxStrategyAssets: "1500000000",
  reserveFloorAssets: "50000000",
  strategyFloorAssets: "0",
  maxRepayPerActionAssets: "500000000",
  lowerLtvWad: (lltv / 5n).toString(),
  targetLtvWad: (lltv / 4n).toString(),
  upperLtvWad: (lltv / 3n).toString(),
  criticalLtvWad: (lltv / 2n).toString(),
  minimumNetSpreadBps: "100",
  maxOracleDivergenceBps: "100",
  harvestThresholdAssets: "10000000",
  triggers: { freezeOnOracleDegraded: true, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true },
  guardian,
};
const intents = [
  { asset: manifest.market.collateralToken, intent: { kind: "PROTECT_AND_BORROW", marketId: manifest.market.id } },
  { asset: manifest.market.loanToken, intent: { kind: "EARN_STABLE", vaultId: `${chainId}:${manifest.vault.address}` } },
];

async function stagingSignature(signer = ownerSigner, nonce = 1n, policy = draft, intentList = intents): Promise<Hex> {
  const result = compilePolicy({ ...policy, intents: intentList }, routeContextOf(manifest, { account, owner }));
  if (!result.ok) throw new Error(`invalid signed test policy: ${result.issues.join("; ")}`);
  return signer.signMessage({ message: policyStagingMessage({
    chainId, account, policyNonce: nonce, policyHash: result.policy.policyHash, contentHash: result.policy.contentHash,
  }) });
}

const ownerSignature = await stagingSignature();

const routeRow = {
  marketId: manifest.market.id,
  loanTokenId: "11111111-1111-4111-8111-111111111111",
  marketLltvWad: manifest.market.lltv,
  vaultDeploymentId: "22222222-2222-4222-8222-222222222222",
};
const registeredRow = {
  id: "33333333-3333-4333-8333-333333333333",
  ownerId: "44444444-4444-4444-8444-444444444444",
  ownerAddress: owner.slice(2).toLowerCase(),
  codeHash: codeHash.slice(2).toLowerCase(),
  status: "pending_policy",
};

interface FakeRows {
  owner?: unknown[];
  account?: unknown[];
  policy?: unknown[];
  route?: unknown[];
  registered?: unknown[];
  existing?: unknown[];
}

/** Reads drizzle's static SQL chunks; parameter chunks are skipped, so a caller value can never appear here. */
function stringChunkText(chunk: unknown): string {
  if (!isRecord(chunk) || !Array.isArray(chunk.value)) return "";
  return chunk.value.every((item) => typeof item === "string") ? chunk.value.join("") : "";
}

function sqlText(query: SQL): string {
  if (!isRecord(query) || !Array.isArray(query.queryChunks)) return "";
  return query.queryChunks.map(stringChunkText).join("");
}

/** The primitive bind parameters, in order; static SQL text and nested SQL chunks are not parameters. */
function sqlParams(query: SQL): unknown[] {
  if (!isRecord(query) || !Array.isArray(query.queryChunks)) return [];
  return query.queryChunks.filter(
    (chunk) => typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "bigint" || typeof chunk === "boolean",
  );
}

function fakeDatabase(rows: FakeRows = {}): { db: EnrollmentDatabase; calls: string[]; params: unknown[][] } {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const db: EnrollmentDatabase = {
    async execute(query) {
      const text = sqlText(query);
      calls.push(text);
      params.push(sqlParams(query));
      if (text.includes("insert into owners")) return rows.owner ?? [{ id: registeredRow.ownerId }];
      if (text.includes("insert into crest_accounts")) return rows.account ?? [{ id: registeredRow.id, status: "pending_policy" }];
      if (text.includes("insert into policies")) return rows.policy ?? [{ status: "pending", policyNonce: "1" }];
      if (text.includes("from morpho_markets")) return rows.route ?? [routeRow];
      if (text.includes("from crest_accounts c")) return rows.registered ?? [registeredRow];
      if (text.includes("from policies")) return rows.existing ?? [];
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, calls, params };
}

function fakeReader(overrides: Partial<EnrollmentBlockHashReader> = {}): EnrollmentBlockHashReader {
  const base: EnrollmentBlockHashReader = {
    getChainId: async () => chainId,
    getFinalizedBlockNumber: async () => finalized,
    getTransactionReceipt: async () => ({ status: "success", blockNumber: receiptBlock, blockHash, contractAddress: account }),
    getTransaction: async () => ({ to: null, input: deploymentInput, from: owner }),
    getBlockHash: async () => blockHash,
    getCode: async () => code,
    readOwner: async () => owner,
    readMorpho: async () => morpho,
    readPolicyNonce: async () => 0n,
    verifyOwnerMessage: async (address, message, signature) =>
      (await recoverMessageAddress({ message, signature })).toLowerCase() === address.toLowerCase(),
  };
  return { ...base, ...overrides };
}

function service(reader: EnrollmentBlockHashReader, db: EnrollmentDatabase) {
  return createEnrollment({ manifest, reader, db, now: () => new Date("2026-10-01T00:00:00.000Z") });
}

describe("owner enrollment", () => {
  test("registers a canonically deployed account and stages a pending policy bound to the verified route", async () => {
    const { db, calls } = fakeDatabase();
    const result = await service(fakeReader(), db).register({ transactionHash, account, owner, policy: draft, intents, ownerSignature });

    expect(result.evidence).toBe("canonical-deployment");
    expect(result.chainId).toBe(chainId);
    expect(result.account).toStrictEqual({
      address: account,
      owner,
      codeHash,
      status: "pending_policy",
      deployment: { transactionHash, blockNumber: "150", blockHash },
    });
    expect(result.policy?.status).toBe("pending");
    expect(result.policy?.policyNonce).toBe("1");
    expect(result.policy?.schemaVersion).toBe(2);
    expect(result.policy?.contentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.policy?.policyHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.policy?.configurationCall).toMatchObject({
      chainId,
      from: owner,
      to: account,
      value: "0",
      functionName: "configure",
    });
    expect(result.policy?.configurationCall.data.startsWith("0x")).toBe(true);
    expect(calls.some((text) => text.includes("insert into owners"))).toBe(true);
    expect(calls.some((text) => text.includes("insert into crest_accounts"))).toBe(true);
    expect(calls.some((text) => text.includes("insert into policies"))).toBe(true);
  });

  test("missing or foreign staging consent cannot persist a policy during registration", async () => {
    const missing = fakeDatabase();
    await expect(service(fakeReader(), missing.db).register({ transactionHash, account, owner, policy: draft, intents }))
      .rejects.toMatchObject({ status: 401 });
    expect(missing.calls).toEqual([]);

    const foreign = fakeDatabase();
    const wrongSignature = await stagingSignature(privateKeyToAccount(`0x${"55".repeat(32)}`));
    await expect(service(fakeReader(), foreign.db).register({
      transactionHash, account, owner, policy: draft, intents, ownerSignature: wrongSignature,
    })).rejects.toMatchObject({ status: 401 });
    expect(foreign.calls).toEqual([]);
    await expect(service(fakeReader(), foreign.db).register({
      transactionHash, account, owner, policy: draft, intents, ownerSignature: "0x12",
    })).rejects.toMatchObject({ status: 401 });
  });

  test("never interpolates the caller's address, hash, or payload into SQL text", async () => {
    const { db, calls } = fakeDatabase();
    await service(fakeReader(), db).register({ transactionHash, account, owner, policy: draft, intents, ownerSignature });

    for (const text of calls) {
      expect(text).not.toContain(account.slice(2));
      expect(text).not.toContain(owner.slice(2));
      expect(text).not.toContain(transactionHash.slice(2));
      expect(text).not.toContain(blockHash.slice(2));
      expect(text).not.toContain("configure");
    }
  });

  test("registers a deployment before any policy exists", async () => {
    const { db, calls } = fakeDatabase();
    const result = await service(fakeReader(), db).register({ transactionHash, account, owner });

    expect(result.account.status).toBe("pending_policy");
    expect(result.policy).toBeNull();
    expect(calls.some((text) => text.includes("insert into policies"))).toBe(false);
  });

  test("refuses a receipt whose block hash is no longer canonical", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ getBlockHash: async () => otherBlockHash }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a deployment that is not finalized", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ getFinalizedBlockNumber: async () => receiptBlock - 1n }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a wrong chain", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ getChainId: async () => 1 }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses an unreadable or missing receipt", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ getTransactionReceipt: async () => null }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a reverted deployment transaction", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(
        fakeReader({ getTransactionReceipt: async () => ({ status: "reverted", blockNumber: receiptBlock, blockHash, contractAddress: account }) }),
        db,
      ).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a receipt whose contract address is not the claimed account", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(
        fakeReader({ getTransactionReceipt: async () => ({ status: "success", blockNumber: receiptBlock, blockHash, contractAddress: otherAccount }) }),
        db,
      ).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a transaction that is not a contract creation", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ getTransaction: async () => ({ to: otherAccount, input: deploymentInput, from: owner }) }), db)
        .register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("rejects a deployment sent by a different wallet than the claimed owner", async () => {
    const { db, calls } = fakeDatabase();
    await expect(
      service(fakeReader({ getTransaction: async () => ({ to: null, input: deploymentInput, from: otherOwner }) }), db)
        .register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
    expect(calls).toStrictEqual([]);
  });

  test("refuses arbitrary bytecode that is not the reviewed account with constructor(owner, morpho)", async () => {
    const { db, calls } = fakeDatabase();
    const tampered = encodeDeployData({
      abi: crestAccountAbi as Abi,
      bytecode: crestAccountCreationBytecode,
      args: [otherOwner, morpho],
    });
    await expect(
      service(fakeReader({ getTransaction: async () => ({ to: null, input: tampered, from: owner }) }), db)
        .register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
    expect(calls).toStrictEqual([]);
  });

  test("refuses an address with no deployed code", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ getCode: async () => "0x" }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses an owner() that does not match the claimed owner", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ readOwner: async () => otherOwner }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses a morpho() that is not the manifest Morpho deployment", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ readMorpho: async () => otherAccount }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("refuses an account already configured onchain when a policy is supplied", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader({ readPolicyNonce: async () => 1n }), db).register({ transactionHash, account, owner, policy: draft, intents }),
    ).rejects.toMatchObject({ status: 409 });
  });
  test("refuses an already-configured account even when no draft is supplied", async () => {
    const { db, calls } = fakeDatabase();
    await expect(
      service(fakeReader({ readPolicyNonce: async () => 1n }), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 409 });
    expect(calls).toStrictEqual([]);
  });


  test("refuses a conflicting replay for a registered account", async () => {
    const { db } = fakeDatabase({ account: [] });
    await expect(
      service(fakeReader(), db).register({ transactionHash, account, owner }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("refuses to stage a policy against a route that is not registered in the database", async () => {
    const { db } = fakeDatabase({ route: [] });
    await expect(
      service(fakeReader(), db).register({ transactionHash, account, owner, policy: draft, intents, ownerSignature }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("rejects malformed addresses, hashes, and an incomplete policy/intents pair", async () => {
    const { db } = fakeDatabase();
    const svc = service(fakeReader(), db);
    await expect(svc.register({ transactionHash, account: "0x1234", owner })).rejects.toMatchObject({ status: 400 });
    await expect(svc.register({ transactionHash: "0xabcd", account, owner })).rejects.toMatchObject({ status: 400 });
    await expect(svc.register({ transactionHash, account, owner, policy: draft })).rejects.toMatchObject({ status: 400 });
  });

  test("rejects a policy draft that is invalid against the reviewed route", async () => {
    const { db } = fakeDatabase();
    await expect(
      service(fakeReader(), db).register({ transactionHash, account, owner, policy: { ...draft, route: { chainId: "4663" } }, intents }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("owner policy staging", () => {
  test("stages the next policy nonce for an already registered account", async () => {
    const { db, calls, params } = fakeDatabase();
    const result = await service(fakeReader({ readPolicyNonce: async () => 3n }), db).stagePolicy(account, { owner, policy: draft, intents, ownerSignature: await stagingSignature(ownerSigner, 4n) });

    expect(result.evidence).toBe("canonical-deployment");
    expect(result.account).toBe(account);
    expect(result.policy.status).toBe("pending");
    const insert = calls.findIndex((text) => text.includes("insert into policies"));
    expect(insert).toBeGreaterThanOrEqual(0);
    expect(params[insert]?.[1]).toBe("4");
  });

  test("returns the already staged identical policy without inserting again", async () => {
    const { db, calls } = fakeDatabase({ existing: [{ id: registeredRow.id, status: "pending", policyNonce: "1" }] });
    const result = await service(fakeReader(), db).stagePolicy(account, { owner, policy: draft, intents, ownerSignature });

    expect(result.policy.status).toBe("pending");
    expect(result.policy.policyNonce).toBe("1");
    expect(calls.some((text) => text.includes("insert into policies"))).toBe(false);
  });

  test("missing or wrong-owner consent cannot stage, including against an existing pending nonce", async () => {
    const missing = fakeDatabase();
    await expect(service(fakeReader(), missing.db).stagePolicy(account, { owner, policy: draft, intents }))
      .rejects.toMatchObject({ status: 401 });
    const wrongSignature = await stagingSignature(privateKeyToAccount(`0x${"55".repeat(32)}`));
    const foreign = fakeDatabase();
    await expect(service(fakeReader(), foreign.db).stagePolicy(account, {
      owner, policy: draft, intents, ownerSignature: wrongSignature,
    })).rejects.toMatchObject({ status: 401 });
    expect(foreign.calls.some((text) => text.includes("insert into policies"))).toBe(false);
  });
  test("signature for another nonce or another typed draft cannot stage a policy", async () => {
    const next = { ...draft, minimumNetSpreadBps: "200" };
    for (const [reader, body] of [
      [fakeReader({ readPolicyNonce: async () => 1n }), { owner, policy: draft, intents, ownerSignature }],
      [fakeReader(), { owner, policy: next, intents, ownerSignature }],
    ] as const) {
      const { db, calls } = fakeDatabase();
      await expect(service(reader, db).stagePolicy(account, body)).rejects.toMatchObject({ status: 401 });
      expect(calls.some((text) => text.includes("insert into policies"))).toBe(false);
    }
  });


  test("refuses to stage a policy for an unregistered account", async () => {
    const { db } = fakeDatabase({ registered: [] });
    await expect(service(fakeReader(), db).stagePolicy(account, { owner, policy: draft, intents })).rejects.toMatchObject({ status: 404 });
  });

  test("refuses to stage a policy for a different owner", async () => {
    const { db } = fakeDatabase({
      registered: [{ ...registeredRow, ownerAddress: otherOwner.slice(2).toLowerCase() }],
    });
    await expect(service(fakeReader(), db).stagePolicy(account, { owner, policy: draft, intents })).rejects.toMatchObject({ status: 409 });
  });

  test("refuses staging when onchain code no longer matches the registered code hash", async () => {
    const { db } = fakeDatabase({ registered: [{ ...registeredRow, codeHash: "00".repeat(32) }] });
    await expect(service(fakeReader(), db).stagePolicy(account, { owner, policy: draft, intents })).rejects.toMatchObject({ status: 422 });
  });

  test("rejects an invalid account path parameter", async () => {
    const { db } = fakeDatabase();
    await expect(service(fakeReader(), db).stagePolicy("0x1234", { owner, policy: draft, intents })).rejects.toMatchObject({ status: 400 });
  });
});

describe("enrollment route surface", () => {
  const body = JSON.stringify({ transactionHash, account, owner });

  test("fails closed without an explicit RPC-backed enrollment", async () => {
    const app = createApp(manifest, {});
    const response = await app.request("/v1/accounts/register", { method: "POST", body });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "enrollment requires ROBINHOOD_CHAIN_RPC_URL" });
  });

  test("rejects an oversized enrollment body before parsing", async () => {
    const { db } = fakeDatabase();
    const app = createApp(manifest, { enrollment: service(fakeReader(), db) });
    const response = await app.request("/v1/accounts/register", { method: "POST", body: "x".repeat(20_000) });
    expect(response.status).toBe(415);
  });

  test("rejects a non-JSON enrollment body", async () => {
    const { db } = fakeDatabase();
    const app = createApp(manifest, { enrollment: service(fakeReader(), db) });
    const response = await app.request("/v1/accounts/register", { method: "POST", body: "not json" });
    expect(response.status).toBe(400);
  });

  test("registers through the route and stages through the account policy route", async () => {
    const { db } = fakeDatabase();
    const app = createApp(manifest, { enrollment: service(fakeReader(), db) });

    const registered = await app.request("/v1/accounts/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionHash, account, owner }),
    });
    expect(registered.status).toBe(200);
    await expect(registered.json()).resolves.toMatchObject({ evidence: "canonical-deployment", policy: null });

    const staged = await app.request(`/v1/accounts/${account}/policies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner, policy: draft, intents, ownerSignature }),
    });
    expect(staged.status).toBe(200);
    await expect(staged.json()).resolves.toMatchObject({ account, policy: { status: "pending" } });
  });
});
