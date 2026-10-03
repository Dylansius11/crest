import { sql, type SQL } from "drizzle-orm";
import { encodeDeployData, getAddress, isAddress, keccak256, parseAbi } from "viem";
import type { Abi, Address, Hex, PublicClient } from "viem";
import { z } from "zod";

import { crestAccountAbi, crestAccountCreationBytecode } from "@crest/contracts";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { hashSchema } from "@crest/domain";
import { compilePolicy, policyStagingMessage, routeContextOf, toConfigurationCall } from "@crest/policy";
import type { CompiledPolicy } from "@crest/policy";

/**
 * Owner enrollment: turn a real, canonical deployment receipt into a registered Crest Account and a staged
 * owner policy that only the monitor's canonical `PolicyConfigured` proof may activate.
 *
 * This module never signs, never calls a Guardian method, and never writes an active policy, active account,
 * or effective block. Every accepted fact is bound to one canonical block, and the account address is proven
 * to be exactly the reviewed `CrestAccount` bytecode deployed with `constructor(owner, manifest.morpho)`.
 */

export const MAX_ENROLLMENT_BODY_BYTES = 16_384;

/** The reviewed contract version persisted with a registered account; the artifact is the only source. */
const CONTRACT_VERSION = "1";

const ACCOUNT_READ_ABI = parseAbi([
  "function owner() view returns (address)",
  "function morpho() view returns (address)",
  "function policyNonce() view returns (uint64)",
]);

export type EnrollmentStatus = 400 | 401 | 404 | 409 | 415 | 422 | 503;

/** A refusal the route can render verbatim; the message never carries chain data a caller did not supply. */
export class EnrollmentError extends Error {
  readonly status: EnrollmentStatus;

  constructor(status: EnrollmentStatus, message: string) {
    super(message);
    this.name = "EnrollmentError";
    this.status = status;
  }
}

export interface EnrollmentBlockHashReader {
  getChainId(): Promise<number>;
  getFinalizedBlockNumber(): Promise<bigint>;
  getTransactionReceipt(hash: Hex): Promise<{
    status: "success" | "reverted";
    blockNumber: bigint;
    blockHash: Hex;
    contractAddress: Address | null;
  } | null>;
  getTransaction(hash: Hex): Promise<{ to: Address | null; input: Hex; from: Address } | null>;
  getBlockHash(blockNumber: bigint): Promise<Hex | null>;
  getCode(address: Address, blockNumber: bigint): Promise<Hex>;
  readOwner(address: Address, blockNumber: bigint): Promise<Address>;
  readMorpho(address: Address, blockNumber: bigint): Promise<Address>;
  readPolicyNonce(address: Address, blockNumber: bigint): Promise<bigint>;
  verifyOwnerMessage(address: Address, message: string, signature: Hex, blockNumber: bigint): Promise<boolean>;
}

export interface EnrollmentDatabase {
  execute(query: SQL): Promise<unknown>;
}

export interface EnrollmentOptions {
  manifest: DeploymentManifest;
  reader: EnrollmentBlockHashReader;
  db: EnrollmentDatabase;
  now?: () => Date;
}

export interface EnrollmentConfigurationCall {
  chainId: number;
  from: string;
  to: string;
  value: string;
  data: string;
  selector: string;
  functionName: "configure";
}

export interface EnrollmentPolicyView {
  status: string;
  policyNonce: string;
  schemaVersion: number;
  contentHash: string;
  policyHash: string;
  configurationCall: EnrollmentConfigurationCall;
}

export interface EnrollmentAccountView {
  address: string;
  owner: string;
  codeHash: string;
  status: string;
  deployment: { transactionHash: string; blockNumber: string; blockHash: string };
}

export interface RegisterResponse {
  evidence: "canonical-deployment";
  chainId: number;
  account: EnrollmentAccountView;
  /** Null until an owner policy is staged; the owner may deploy first and stage a draft afterwards. */
  policy: EnrollmentPolicyView | null;
}

export interface StagePolicyResponse {
  evidence: "canonical-deployment";
  chainId: number;
  account: string;
  policy: EnrollmentPolicyView;
}

const policyObject = z.record(z.string(), z.unknown());
const intentsList = z.array(z.unknown()).min(1).max(32);

const registerBodySchema = z.strictObject({
  transactionHash: hashSchema,
  account: z.string(),
  owner: z.string(),
  policy: policyObject.optional(),
  ownerSignature: z.string().optional(),
  intents: intentsList.optional(),
}).superRefine((value, context) => {
  if ((value.policy === undefined) !== (value.intents === undefined)) {
    context.addIssue({ code: "custom", message: "policy and intents must be supplied together" });
  }
});

const stageBodySchema = z.strictObject({
  owner: z.string(),
  policy: policyObject,
  intents: intentsList,
  ownerSignature: z.string().optional(),
});

export interface Enrollment {
  register(body: unknown): Promise<RegisterResponse>;
  stagePolicy(address: string, body: unknown): Promise<StagePolicyResponse>;
}

/** Binds a viem public client to the exact reads enrollment needs; the client always comes from an explicit RPC URL. */
export function createEnrollmentChainReader(client: PublicClient): EnrollmentBlockHashReader {
  return {
    getChainId: () => client.getChainId(),
    async getFinalizedBlockNumber() {
      const block = await client.getBlock({ blockTag: "finalized" });
      if (block.number === null) throw new Error("finalized block has no number");
      return block.number;
    },
    async getTransactionReceipt(hash) {
      const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
      if (!receipt) return null;
      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        contractAddress: receipt.contractAddress ?? null,
      };
    },
    async getTransaction(hash) {
      const transaction = await client.getTransaction({ hash }).catch(() => null);
      if (!transaction) return null;
      return { to: transaction.to, input: transaction.input, from: transaction.from };
    },
    async getBlockHash(blockNumber) {
      const block = await client.getBlock({ blockNumber }).catch(() => null);
      return block?.hash ?? null;
    },
    getCode: (address, blockNumber) => client.getCode({ address, blockNumber }).then((code) => code ?? "0x"),
    readOwner: (address, blockNumber) =>
      client.readContract({ address, abi: ACCOUNT_READ_ABI, functionName: "owner", blockNumber }),
    readMorpho: (address, blockNumber) =>
      client.readContract({ address, abi: ACCOUNT_READ_ABI, functionName: "morpho", blockNumber }),
    readPolicyNonce: (address, blockNumber) =>
      client.readContract({ address, abi: ACCOUNT_READ_ABI, functionName: "policyNonce", blockNumber }),
    verifyOwnerMessage: (address, message, signature, blockNumber) =>
      client.verifyMessage({ address, message, signature, blockNumber }),
  };
}

/**
 * Fails closed on every unreadable fact. The endpoint is explicit: an unset RPC URL is a 503, never a guess,
 * and a failure to reach the chain is a 503, never a default.
 */
export function createEnrollment(options: EnrollmentOptions): Enrollment {
  const { manifest, reader, db } = options;
  const now = options.now ?? (() => new Date());
  const chainId = manifest.network.chainId;
  const morpho = getAddress(manifest.contracts.morpho?.address ?? "");
  const marketId = manifest.market.id;

  function requireAddress(value: string, field: string): Address {
    if (!isAddress(value, { strict: true })) throw new EnrollmentError(400, `${field} is not a lowercase or EIP-55 address`);
    return getAddress(value);
  }

  function requireHash(value: string, field: string): Hex {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new EnrollmentError(400, `${field} must be a 32-byte hex string`);
    return value as Hex;
  }

  async function requireChain(): Promise<void> {
    let actual: number;
    try {
      actual = await reader.getChainId();
    } catch {
      throw new EnrollmentError(503, "chain is unreachable; refusing to verify enrollment without one exact chain");
    }
    if (actual !== chainId) throw new EnrollmentError(422, `RPC reports chain ${actual}, not the reviewed chain ${chainId}`);
  }

  function compileFor(account: Address, owner: Address, policy: Record<string, unknown>, intents: unknown[]) {
    const route = routeContextOf(manifest, { account, owner });
    const compiled = compilePolicy({ ...policy, intents }, route);
    if (!compiled.ok) throw new EnrollmentError(400, `policy draft is invalid: ${compiled.issues.join("; ")}`);
    return compiled.policy;
  }

  async function requireOwnerConsent(
    owner: Address, account: Address, nonce: bigint, compiled: CompiledPolicy, signature: string | undefined, blockNumber: bigint,
  ): Promise<void> {
    const denied = new EnrollmentError(401, "owner signature does not authorize this policy staging request");
    // Shorter than a compact (EIP-2098) signature cannot authorize anyone; longer forms (ERC-1271/6492) go to verification.
    if (signature === undefined || !/^0x(?:[0-9a-fA-F]{2}){64,}$/.test(signature)) throw denied;
    const message = policyStagingMessage({
      chainId, account, policyNonce: nonce, policyHash: compiled.policyHash, contentHash: compiled.contentHash,
    });
    // An RPC failure is unreadable infrastructure (503 via enrollmentFailure), never a refused signature.
    if (!await reader.verifyOwnerMessage(owner, message, signature as Hex, blockNumber)) throw denied;
  }

  return {
    async register(body) {
      const parsed = registerBodySchema.safeParse(body);
      if (!parsed.success) throw new EnrollmentError(400, describeIssues(parsed.error));
      const { transactionHash, account, owner, policy, intents, ownerSignature } = parsed.data;

      const accountAddress = requireAddress(account, "account");
      const ownerAddress = requireAddress(owner, "owner");
      const hash = requireHash(transactionHash, "transactionHash");

      if (manifest.gate.outcome !== "full_route") {
        throw new EnrollmentError(422, `deployment manifest gate is ${manifest.gate.outcome}; enrollment needs a fully qualified route`);
      }

      await requireChain();
      const finalized = await reader.getFinalizedBlockNumber();

      const receipt = await reader.getTransactionReceipt(hash);
      if (!receipt) throw new EnrollmentError(422, "deployment transaction has no receipt on this chain");
      if (receipt.status !== "success") throw new EnrollmentError(422, "deployment transaction did not succeed");
      if (receipt.contractAddress === null || receipt.contractAddress.toLowerCase() !== accountAddress.toLowerCase()) {
        throw new EnrollmentError(422, "deployment receipt contract address is not the claimed account");
      }
      if (receipt.blockNumber > finalized) throw new EnrollmentError(422, "deployment receipt is not on the finalized chain");

      const canonicalHash = await reader.getBlockHash(receipt.blockNumber);
      if (canonicalHash === null || canonicalHash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
        throw new EnrollmentError(422, "deployment receipt block is not canonical");
      }

      const transaction = await reader.getTransaction(hash);
      if (!transaction) throw new EnrollmentError(422, "deployment transaction is unavailable");
      if (transaction.to !== null) throw new EnrollmentError(422, "deployment transaction is not a contract creation");
      if (transaction.from.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new EnrollmentError(422, "deployment was not submitted by the claimed owner wallet");
      }

      const expectedInput = encodeDeployData({
        abi: crestAccountAbi as Abi,
        bytecode: crestAccountCreationBytecode,
        args: [ownerAddress, morpho],
      });
      if (transaction.input.toLowerCase() !== expectedInput.toLowerCase()) {
        throw new EnrollmentError(422, "deployment input does not match the reviewed Crest Account bytecode with constructor(owner, morpho)");
      }

      const code = await reader.getCode(accountAddress, receipt.blockNumber);
      if (code === "0x") throw new EnrollmentError(422, "no contract code exists at the claimed account");

      // Read failures propagate as unreadable infrastructure; only a value that was read can be refused.
      const [onchainOwner, onchainMorpho, onchainNonce] = await Promise.all([
        reader.readOwner(accountAddress, receipt.blockNumber),
        reader.readMorpho(accountAddress, receipt.blockNumber),
        reader.readPolicyNonce(accountAddress, receipt.blockNumber),
      ]);
      if (onchainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new EnrollmentError(422, "account owner() does not match the claimed owner");
      }
      if (onchainMorpho.toLowerCase() !== morpho.toLowerCase()) {
        throw new EnrollmentError(422, "account morpho() is not the manifest Morpho deployment");
      }
      if (onchainNonce !== 0n) {
        throw new EnrollmentError(409, "account was configured before enrollment; its first policy cannot be reconstructed safely");
      }

      const codeHash = keccak256(code);
      let compiled: CompiledPolicy | null = null;
      let route: RouteIdentity | null = null;
      if (policy !== undefined && intents !== undefined) {
        compiled = compileFor(accountAddress, ownerAddress, policy, intents);
        await requireOwnerConsent(ownerAddress, accountAddress, onchainNonce + 1n, compiled, ownerSignature, receipt.blockNumber);
        route = await resolveRoute(db, chainId, compiled);
      }
      const timestamp = now();

      const ownerId = await upsertOwner(db, ownerAddress, timestamp);
      const accountRow = await upsertAccount(db, {
        chainId,
        address: accountAddress,
        ownerId,
        transactionHash: hash,
        blockNumber: receipt.blockNumber,
        codeHash,
      });
      if (accountRow === null) {
        throw new EnrollmentError(409, "a different deployer, owner, or code hash is already registered for this account");
      }

      let staged: EnrollmentPolicyView | null = null;
      if (compiled !== null && route !== null) {
        const policyRow = await insertPolicy(db, {
          accountId: accountRow.id,
          nonce: onchainNonce + 1n,
          compiled,
          route,
          timestamp,
        });
        if (policyRow === null) {
          throw new EnrollmentError(409, "a different policy is already staged at the next nonce for this account");
        }
        staged = policyView(policyRow.status, policyRow.policyNonce, compiled);
      }

      return {
        evidence: "canonical-deployment",
        chainId,
        account: {
          address: accountAddress,
          owner: ownerAddress,
          codeHash,
          status: accountRow.status,
          deployment: { transactionHash: hash, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash },
        },
        policy: staged,
      };
    },

    async stagePolicy(address, body) {
      const parsed = stageBodySchema.safeParse(body);
      if (!parsed.success) throw new EnrollmentError(400, describeIssues(parsed.error));
      const { owner, policy, intents, ownerSignature } = parsed.data;

      const accountAddress = requireAddress(address, "account");
      const ownerAddress = requireAddress(owner, "owner");

      if (manifest.gate.outcome !== "full_route") {
        throw new EnrollmentError(422, `deployment manifest gate is ${manifest.gate.outcome}; staging needs a fully qualified route`);
      }
      await requireChain();
      const finalized = await reader.getFinalizedBlockNumber();

      const registered = await queryRows<{ id: string; ownerId: string; ownerAddress: string; codeHash: string; status: string }>(db, sql`
        select
          c.id as id,
          c.owner_id as "ownerId",
          encode(o.address, 'hex') as "ownerAddress",
          encode(c.code_hash, 'hex') as "codeHash",
          c.status as status
        from crest_accounts c
        join owners o on o.id = c.owner_id
        where c.chain_id = ${chainId.toString()}
          and c.address = ${bytes(accountAddress)}
      `);
      const account = registered[0];
      if (account === undefined) throw new EnrollmentError(404, "account is not registered");
      if (`0x${account.ownerAddress}`.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new EnrollmentError(409, "account is registered to a different owner");
      }

      const [onchainOwner, onchainNonce, code] = await Promise.all([
        reader.readOwner(accountAddress, finalized),
        reader.readPolicyNonce(accountAddress, finalized),
        reader.getCode(accountAddress, finalized),
      ]);
      if (onchainOwner.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new EnrollmentError(422, "account owner() does not match the claimed owner");
      }
      if (code === "0x") throw new EnrollmentError(422, "no contract code exists at the registered account");
      if (keccak256(code).toLowerCase() !== `0x${account.codeHash}`.toLowerCase()) {
        throw new EnrollmentError(422, "onchain account code no longer matches the registered code hash");
      }

      const compiled = compileFor(accountAddress, ownerAddress, policy, intents);
      await requireOwnerConsent(ownerAddress, accountAddress, onchainNonce + 1n, compiled, ownerSignature, finalized);
      const route = await resolveRoute(db, chainId, compiled);
      const timestamp = now();

      const existing = await queryRows<{ id: string; status: string; policyNonce: string | bigint }>(db, sql`
        select id, status, policy_nonce as "policyNonce"
        from policies
        where crest_account_id = ${account.id}
          and policy_nonce = ${(onchainNonce + 1n).toString()}
          and content_hash = ${bytes(compiled.contentHash)}
          and status in ('pending', 'active')
        order by policy_nonce desc
        limit 1
      `);
      const already = existing[0];
      if (already !== undefined) {
        return {
          evidence: "canonical-deployment",
          chainId,
          account: accountAddress,
          policy: policyView(already.status, String(already.policyNonce), compiled),
        };
      }

      const policyRow = await insertPolicy(db, {
        accountId: account.id,
        nonce: onchainNonce + 1n,
        compiled,
        route,
        timestamp,
      });
      if (policyRow === null) {
        throw new EnrollmentError(409, "a different policy is already staged at the next nonce for this account");
      }

      return {
        evidence: "canonical-deployment",
        chainId,
        account: accountAddress,
        policy: policyView(policyRow.status, policyRow.policyNonce, compiled),
      };
    },
  };
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`)).join("; ");
}

function bytes(value: string): SQL {
  return sql`decode(${value.slice(2)}, 'hex')`;
}

function policyView(status: string, policyNonce: string | bigint, compiled: CompiledPolicy): EnrollmentPolicyView {
  const call = toConfigurationCall(compiled);
  return {
    status,
    policyNonce: String(policyNonce),
    schemaVersion: compiled.policy.schemaVersion,
    contentHash: compiled.contentHash,
    policyHash: compiled.policyHash,
    configurationCall: {
      chainId: call.chainId,
      from: call.from,
      to: call.to,
      value: call.value.toString(),
      data: call.data,
      selector: call.selector,
      functionName: call.functionName,
    },
  };
}

async function queryRows<T>(db: EnrollmentDatabase, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : result.rows ?? [];
}

interface RouteIdentity {
  marketId: string;
  loanTokenId: string;
  marketLltvWad: bigint | string;
  vaultDeploymentId: string;
}

/**
 * The persisted route the policy must point at. A policy row cannot exist without the exact verified market,
 * loan token, and vault already recorded, so enrollment can never invent route identity.
 */
async function resolveRoute(db: EnrollmentDatabase, chainId: number, compiled: CompiledPolicy): Promise<RouteIdentity> {
  const route = compiled.route;
  const rows = await queryRows<RouteIdentity>(db, sql`
    select
      '0x' || encode(mm.id, 'hex') as "marketId",
      mm.loan_token_id as "loanTokenId",
      mm.lltv_wad as "marketLltvWad",
      vd.id as "vaultDeploymentId"
    from morpho_markets mm
    join token_deployments loan
      on loan.id = mm.loan_token_id
      and loan.chain_id = ${chainId.toString()}
      and loan.address = ${bytes(route.market.loanToken)}
    join vault_deployments vd
      on vd.address = ${bytes(route.vault)}
      and vd.chain_id = ${chainId.toString()}
      and vd.asset_token_id = mm.loan_token_id
    where mm.id = ${bytes(route.marketId)}
      and mm.lltv_wad = ${route.market.lltv.toString()}
  `);
  const identity = rows[0];
  if (identity === undefined || identity.marketId.toLowerCase() !== route.marketId.toLowerCase()) {
    throw new EnrollmentError(409, "the verified route is not registered in the database; enroll the route evidence first");
  }
  return identity;
}

async function upsertOwner(db: EnrollmentDatabase, owner: Address, timestamp: Date): Promise<string> {
  const rows = await queryRows<{ id: string }>(db, sql`
    insert into owners (address, first_seen_at, last_seen_at)
    values (${bytes(owner)}, ${timestamp.toISOString()}, ${timestamp.toISOString()})
    on conflict (address) do update set last_seen_at = excluded.last_seen_at
    returning id
  `);
  const row = rows[0];
  if (row === undefined) throw new EnrollmentError(503, "owner registration did not persist");
  return row.id;
}

async function upsertAccount(
  db: EnrollmentDatabase,
  input: {
    chainId: number;
    address: Address;
    ownerId: string;
    transactionHash: Hex;
    blockNumber: bigint;
    codeHash: Hex;
  },
): Promise<{ id: string; status: string } | null> {
  const rows = await queryRows<{ id: string; status: string }>(db, sql`
    insert into crest_accounts
      (chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (
      ${input.chainId.toString()},
      ${bytes(input.address)},
      ${input.ownerId},
      ${bytes(input.transactionHash)},
      ${input.blockNumber.toString()},
      ${CONTRACT_VERSION},
      ${bytes(input.codeHash)},
      0,
      'pending_policy'
    )
    on conflict (chain_id, address) do update set status = crest_accounts.status
    where crest_accounts.owner_id = excluded.owner_id
      and crest_accounts.deployment_transaction_hash = excluded.deployment_transaction_hash
      and crest_accounts.deployment_block_number = excluded.deployment_block_number
      and crest_accounts.code_hash = excluded.code_hash
      and crest_accounts.contract_version = excluded.contract_version
    returning id, status
  `);
  return rows[0] ?? null;
}

async function insertPolicy(
  db: EnrollmentDatabase,
  input: {
    accountId: string;
    nonce: bigint;
    compiled: CompiledPolicy;
    route: RouteIdentity;
    timestamp: Date;
  },
): Promise<{ status: string; policyNonce: string } | null> {
  const rows = await queryRows<{ status: string; policyNonce: string | bigint }>(db, sql`
    insert into policies
      (crest_account_id, policy_nonce, schema_version, typed_json, content_hash, policy_hash, source, status,
       market_id, vault_deployment_id, loan_token_id, market_lltv_wad, drafted_at)
    values (
      ${input.accountId},
      ${input.nonce.toString()},
      ${input.compiled.policy.schemaVersion},
      ${JSON.stringify(storageDraft(input.compiled))}::jsonb,
      ${bytes(input.compiled.contentHash)},
      ${bytes(input.compiled.policyHash)},
      'manual',
      'pending',
      ${bytes(input.route.marketId)},
      ${input.route.vaultDeploymentId},
      ${input.route.loanTokenId},
      ${input.compiled.route.market.lltv.toString()},
      ${input.timestamp.toISOString()}
    )
    on conflict (crest_account_id, policy_nonce) do update set
      schema_version = excluded.schema_version,
      typed_json = excluded.typed_json,
      content_hash = excluded.content_hash,
      policy_hash = excluded.policy_hash,
      source = excluded.source,
      market_id = excluded.market_id,
      vault_deployment_id = excluded.vault_deployment_id,
      loan_token_id = excluded.loan_token_id,
      market_lltv_wad = excluded.market_lltv_wad,
      drafted_at = excluded.drafted_at
    where policies.status = 'pending'
    returning status, policy_nonce as "policyNonce"
  `);
  const row = rows[0];
  if (row === undefined) return null;
  return { status: row.status, policyNonce: String(row.policyNonce) };
}

/**
 * The exact draft the monitor recompiles from `typed_json`. It carries no route: the route is always taken
 * from the deployment manifest at compile time, never from a stored or client-supplied value.
 */
function storageDraft(compiled: CompiledPolicy): unknown {
  const policy = compiled.policy;
  return {
    schemaVersion: policy.schemaVersion,
    maxCollateralAssets: policy.maxCollateralAssets.toString(),
    debtCeilingAssets: policy.debtCeilingAssets.toString(),
    maxStrategyAssets: policy.maxStrategyAssets.toString(),
    reserveFloorAssets: policy.reserveFloorAssets.toString(),
    strategyFloorAssets: policy.strategyFloorAssets.toString(),
    maxRepayPerActionAssets: policy.maxRepayPerActionAssets.toString(),
    lowerLtvWad: policy.lowerLtvWad.toString(),
    targetLtvWad: policy.targetLtvWad.toString(),
    upperLtvWad: policy.upperLtvWad.toString(),
    criticalLtvWad: policy.criticalLtvWad.toString(),
    minimumNetSpreadBps: policy.minimumNetSpreadBps.toString(),
    maxOracleDivergenceBps: policy.maxOracleDivergenceBps.toString(),
    harvestThresholdAssets: policy.harvestThresholdAssets.toString(),
    freshness: {
      maxHeadLagSeconds: policy.freshness.maxHeadLagSeconds.toString(),
      maxFeedAgeSeconds: policy.freshness.maxFeedAgeSeconds.toString(),
      maxQuoteAgeSeconds: policy.freshness.maxQuoteAgeSeconds.toString(),
      maxAssetAgeSeconds: policy.freshness.maxAssetAgeSeconds.toString(),
      maxCorporateActionsAgeSeconds: policy.freshness.maxCorporateActionsAgeSeconds.toString(),
      maxIndexLagBlocks: policy.freshness.maxIndexLagBlocks.toString(),
    },
    triggers: {
      freezeOnOracleDegraded: policy.triggers.freezeOnOracleDegraded,
      freezeOnVaultDegraded: policy.triggers.freezeOnVaultDegraded,
      freezeOnLifecycleDegraded: policy.triggers.freezeOnLifecycleDegraded,
    },
    guardian: policy.guardian,
    intents: compiled.intents.map(({ asset, intent }) => ({ asset, intent })),
  };
}
