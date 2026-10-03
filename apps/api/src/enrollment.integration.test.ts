import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { encodeDeployData, getAddress, keccak256, recoverMessageAddress } from "viem";
import type { Abi, Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { crestAccountAbi, crestAccountCreationBytecode } from "@crest/contracts";
import { computeManifestIntegrity } from "@crest/contracts/manifest";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { createDatabase } from "@crest/db";
import { marketIdOf } from "@crest/morpho";
import { compilePolicy, policyStagingMessage, routeContextOf } from "@crest/policy";

import { createEnrollment } from "./enrollment.ts";
import type { EnrollmentBlockHashReader } from "./enrollment.ts";

// Integration fixtures only run against an explicitly chosen disposable database.
const integrationDatabaseUrl = process.env.API_INTEGRATION_DATABASE_URL;
const { client, db } = createDatabase(integrationDatabaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused");
const baseManifest = await loadDeploymentManifest(
  fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)),
);
const [morpho, loan, collateral, oracle, irm, vault] = Array.from(
  { length: 6 },
  () => getAddress(`0x${randomBytes(20).toString("hex")}`),
) as [Address, Address, Address, Address, Address, Address];
const marketId = marketIdOf({ loanToken: loan, collateralToken: collateral, oracle, irm, lltv: BigInt(baseManifest.market.lltv) });
const manifestWithoutIntegrity = {
  ...baseManifest,
  contracts: {
    ...baseManifest.contracts,
    morpho: { ...baseManifest.contracts.morpho!, address: morpho },
    loanToken: { ...baseManifest.contracts.loanToken!, address: loan },
    collateralToken: { ...baseManifest.contracts.collateralToken!, address: collateral },
    oracle: { ...baseManifest.contracts.oracle!, address: oracle },
    irm: { ...baseManifest.contracts.irm!, address: irm },
    vault: { ...baseManifest.contracts.vault!, address: vault },
  },
  market: {
    ...baseManifest.market,
    id: marketId,
    derivedId: marketId,
    loanToken: loan,
    collateralToken: collateral,
    oracle,
    irm,
  },
  vault: { ...baseManifest.vault, address: vault, asset: loan },
};
const manifest = { ...manifestWithoutIntegrity, integrity: { algorithm: "sha256", digest: computeManifestIntegrity(manifestWithoutIntegrity) } };

const ownerSigner = privateKeyToAccount(`0x${"66".repeat(32)}`);
const owner = ownerSigner.address;
const account = getAddress(`0x${randomBytes(20).toString("hex")}`);
const guardian = getAddress(`0x${randomBytes(20).toString("hex")}`);
const blockHash = `0x${"ab".repeat(32)}` as Hex;
const receiptBlock = 150n;
const finalized = 200n;
const code = `0x6001${"11".repeat(20)}` as Hex;
const route = routeContextOf(manifest, { account, owner });
const draft = {
  schemaVersion: 2,
  maxCollateralAssets: "10000000000000000000",
  debtCeilingAssets: "1500000000",
  maxStrategyAssets: "1500000000",
  reserveFloorAssets: "50000000",
  strategyFloorAssets: "0",
  maxRepayPerActionAssets: "500000000",
  lowerLtvWad: (BigInt(manifest.market.lltv) / 5n).toString(),
  targetLtvWad: (BigInt(manifest.market.lltv) / 4n).toString(),
  upperLtvWad: (BigInt(manifest.market.lltv) / 3n).toString(),
  criticalLtvWad: (BigInt(manifest.market.lltv) / 2n).toString(),
  minimumNetSpreadBps: "100",
  maxOracleDivergenceBps: "100",
  harvestThresholdAssets: "10000000",
  triggers: { freezeOnOracleDegraded: true, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true },
  guardian,
};
const intents = [
  { asset: manifest.market.collateralToken, intent: { kind: "PROTECT_AND_BORROW", marketId: manifest.market.id } },
  { asset: manifest.market.loanToken, intent: { kind: "EARN_STABLE", vaultId: `${manifest.network.chainId}:${manifest.vault.address}` } },
];
const compilation = compilePolicy({ ...draft, intents }, route);
if (!compilation.ok) throw new Error(compilation.issues.join("; "));
const compiled = compilation.policy;

async function signedDraft(policy: typeof draft, nonce: bigint, signer = ownerSigner): Promise<Hex> {
  const result = compilePolicy({ ...policy, intents }, route);
  if (!result.ok) throw new Error(result.issues.join("; "));
  return signer.signMessage({ message: policyStagingMessage({
    chainId: manifest.network.chainId, account, policyNonce: nonce,
    policyHash: result.policy.policyHash, contentHash: result.policy.contentHash,
  }) });
}

const transactionHash = `0x${randomBytes(32).toString("hex")}` as Hex;
const deploymentInput = encodeDeployData({
  abi: crestAccountAbi as Abi,
  bytecode: crestAccountCreationBytecode,
  args: [owner, morpho],
});

const id = {
  loanAsset: randomUUID(),
  collateralAsset: randomUUID(),
  loanToken: randomUUID(),
  collateralToken: randomUUID(),
  morpho: randomUUID(),
  vault: randomUUID(),
};
const hash = Buffer.from("cd".repeat(32), "hex");
const bytes = (value: string) => Buffer.from(value.slice(2), "hex");

function readerWithCode(deployedCode: Hex): EnrollmentBlockHashReader {
  return {
    getChainId: async () => manifest.network.chainId,
    getFinalizedBlockNumber: async () => finalized,
    getTransactionReceipt: async () => ({ status: "success", blockNumber: receiptBlock, blockHash, contractAddress: account }),
    getTransaction: async () => ({ to: null, input: deploymentInput, from: owner }),
    getBlockHash: async () => blockHash,
    getCode: async () => deployedCode,
    readOwner: async () => owner,
    readMorpho: async () => morpho,
    readPolicyNonce: async () => 0n,
    verifyOwnerMessage: async (address, message, signature) =>
      (await recoverMessageAddress({ message, signature })).toLowerCase() === address.toLowerCase(),
  };
}

const enrollment = createEnrollment({
  manifest,
  reader: readerWithCode(code),
  db,
  now: () => new Date("2026-10-01T00:00:00.000Z"),
});

(integrationDatabaseUrl ? describe : describe.skip)("owner enrollment persistence", () => {
  beforeAll(async () => {
    await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
      values (${manifest.network.chainId}, ${`enroll-${randomUUID()}`}, 'Enrollment test', 'ETH', 20, true)
      on conflict (chain_id) do update set enabled = true`;
    await client`insert into assets (id, canonical_symbol, kind, metadata_json) values
      (${id.loanAsset}, 'ENROLL_LOAN', 'stablecoin', '{}'::jsonb),
      (${id.collateralAsset}, 'ENROLL_COLLATERAL', 'stock_token', '{}'::jsonb)`;
    await client`insert into token_deployments
      (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values
      (${id.loanToken}, ${id.loanAsset}, ${manifest.network.chainId}, ${bytes(loan)}, 6, ${hash}, 'https://example.com/loan', 1, ${hash}, now(), 'verified'),
      (${id.collateralToken}, ${id.collateralAsset}, ${manifest.network.chainId}, ${bytes(collateral)}, 18, ${hash}, 'https://example.com/collateral', 1, ${hash}, now(), 'verified')`;
    await client`insert into morpho_deployments
      (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
      values (${id.morpho}, ${manifest.network.chainId}, ${bytes(morpho)}, ${hash}, '1', 'https://example.com/morpho', 1, ${hash}, now(), 'verified')`;
    await client`insert into morpho_markets
      (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
      values (${bytes(marketId)}, ${id.morpho}, ${id.loanToken}, ${id.collateralToken}, ${bytes(oracle)}, ${bytes(irm)}, ${manifest.market.lltv}, true, 'verified', now())`;
    await client`insert into vault_deployments
      (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json,
       source_url, verified_block_number, verified_block_hash, verified_at, status)
      values (${id.vault}, ${manifest.network.chainId}, ${bytes(vault)}, ${id.loanToken}, 18, 'fixed_adapter', ${hash}, 'none',
       '{}'::jsonb, 'https://example.com/vault', 1, ${hash}, now(), 'verified')`;
  });

  afterAll(async () => {
    await client`delete from policies where crest_account_id in (select id from crest_accounts where address = ${bytes(account)})`;
    await client`delete from crest_accounts where address = ${bytes(account)}`;
    await client`delete from owners where address = ${bytes(owner)}`;
    await client`delete from vault_deployments where id = ${id.vault}`;
    await client`delete from morpho_markets where id = ${bytes(marketId)}`;
    await client`delete from morpho_deployments where id = ${id.morpho}`;
    await client`delete from token_deployments where id in (${id.loanToken}, ${id.collateralToken})`;
    await client`delete from assets where id in (${id.loanAsset}, ${id.collateralAsset})`;
    await client.end();
  });

  test("rejects unsigned and foreign-signed drafts before writing account or policy rows", async () => {
    await expect(enrollment.register({ transactionHash, account, owner, policy: draft, intents }))
      .rejects.toMatchObject({ status: 401 });
    await expect(enrollment.register({
      transactionHash, account, owner, policy: draft, intents,
      ownerSignature: await signedDraft(draft, 1n, privateKeyToAccount(`0x${"77".repeat(32)}`)),
    })).rejects.toMatchObject({ status: 401 });
    expect(await client`select id from crest_accounts where address = ${bytes(account)}`).toHaveLength(0);
  });

  test("registers a real deployment once and stages a policy the monitor can recompile", async () => {
    const registered = await enrollment.register({ transactionHash, account, owner, policy: draft, intents, ownerSignature: await signedDraft(draft, 1n) });
    expect(registered.account.status).toBe("pending_policy");
    expect(registered.policy?.policyNonce).toBe("1");

    const [accountRow] = await client`select id, status, indexed_policy_nonce as nonce, encode(code_hash, 'hex') as code_hash
      from crest_accounts where chain_id = ${manifest.network.chainId} and address = ${bytes(account)}`;
    expect(accountRow?.status).toBe("pending_policy");
    expect(accountRow?.nonce).toBe("0");
    expect(`0x${accountRow?.code_hash}`).toBe(registered.account.codeHash);

    const [ownerRow] = await client`select id from owners where address = ${bytes(owner)}`;
    expect(ownerRow?.id).toBeTruthy();

    const policies = await client`select status, policy_nonce as nonce, typed_json, encode(content_hash, 'hex') as content_hash,
        encode(policy_hash, 'hex') as policy_hash, effective_block_number, effective_block_hash, activated_at,
        encode(market_id, 'hex') as market_id, vault_deployment_id, loan_token_id, market_lltv_wad
      from policies where crest_account_id = ${accountRow?.id}`;
    expect(policies).toHaveLength(1);
    const policy = policies[0]!;
    expect(policy.status).toBe("pending");
    expect(policy.nonce).toBe("1");
    expect(policy.effective_block_number).toBeNull();
    expect(policy.effective_block_hash).toBeNull();
    expect(policy.activated_at).toBeNull();
    expect(`0x${policy.content_hash}`).toBe(compiled.contentHash);
    expect(`0x${policy.policy_hash}`).toBe(compiled.policyHash);
    expect(`0x${policy.market_id}`.toLowerCase()).toBe(route.marketId.toLowerCase());
    expect(policy.vault_deployment_id).toBe(id.vault);
    expect(policy.loan_token_id).toBe(id.loanToken);
    expect(policy.market_lltv_wad).toBe(manifest.market.lltv);

    // The monitor recompiles this exact stored draft; the hashes must survive the round trip through jsonb.
    const recompiled = compilePolicy(policy.typed_json, route);
    expect(recompiled.ok).toBe(true);
    if (recompiled.ok) {
      expect(recompiled.policy.contentHash).toBe(compiled.contentHash);
      expect(recompiled.policy.policyHash).toBe(compiled.policyHash);
    }
  });

  test("is idempotent: a replay inserts no second owner, account, or policy", async () => {
    await enrollment.register({ transactionHash, account, owner, policy: draft, intents, ownerSignature: await signedDraft(draft, 1n) });

    const owners = await client`select id from owners where address = ${bytes(owner)}`;
    const accounts = await client`select id from crest_accounts where chain_id = ${manifest.network.chainId} and address = ${bytes(account)}`;
    expect(owners).toHaveLength(1);
    expect(accounts).toHaveLength(1);
    const policies = await client`select id from policies where crest_account_id = ${accounts[0]!.id}`;
    expect(policies).toHaveLength(1);
  });

  test("refuses a conflicting replay that changes the deployed code without mutating the registered row", async () => {
    const conflicting = createEnrollment({ manifest, reader: readerWithCode(`0x6001${"22".repeat(20)}`), db });
    await expect(conflicting.register({ transactionHash, account, owner })).rejects.toMatchObject({ status: 409 });

    const [accountRow] = await client`select encode(code_hash, 'hex') as code_hash from crest_accounts
      where chain_id = ${manifest.network.chainId} and address = ${bytes(account)}`;
    expect(`0x${accountRow?.code_hash}`).toBe(keccak256(code));
  });

  test("stages the next policy nonce only once per identical draft", async () => {
    const staging = createEnrollment({ manifest, reader: { ...readerWithCode(code), readPolicyNonce: async () => 1n }, db });
    const next = { ...draft, debtCeilingAssets: "2000000000" };
    const ownerSignature = await signedDraft(next, 2n);
    const first = await staging.stagePolicy(account, { owner, policy: next, intents, ownerSignature });
    expect(first.policy.status).toBe("pending");
    const replay = await staging.stagePolicy(account, { owner, policy: next, intents, ownerSignature });
    expect(replay.policy.policyNonce).toBe(first.policy.policyNonce);

    const [accountRow] = await client`select id from crest_accounts where chain_id = ${manifest.network.chainId} and address = ${bytes(account)}`;
    const staged = await client`select id from policies where crest_account_id = ${accountRow?.id} and content_hash = ${bytes(first.policy.contentHash)}`;
    expect(staged).toHaveLength(1);
  });

  test("owner-signed restaging replaces a pending candidate without changing its nonce", async () => {
    const staging = createEnrollment({ manifest, reader: { ...readerWithCode(code), readPolicyNonce: async () => 1n }, db });
    const replacement = { ...draft, debtCeilingAssets: "2100000000" };
    const signed = await signedDraft(replacement, 2n);
    const result = await staging.stagePolicy(account, { owner, policy: replacement, intents, ownerSignature: signed });
    expect(result.policy.status).toBe("pending");
    expect(result.policy.policyNonce).toBe("2");
    const [row] = await client`select encode(content_hash, 'hex') as content_hash, encode(policy_hash, 'hex') as policy_hash,
      count(*) over ()::int as candidate_count from policies where crest_account_id in (select id from crest_accounts where address = ${bytes(account)}) and policy_nonce = 2`;
    expect(row?.candidate_count).toBe(1);
    expect(`0x${row?.content_hash}`).toBe(result.policy.contentHash);
    expect(`0x${row?.policy_hash}`).toBe(result.policy.policyHash);
  });

  test("owner-signed restaging never overwrites an active policy", async () => {
    const [current] = await client`update policies set status = 'active', effective_block_number = 150,
      effective_block_hash = ${bytes(blockHash)}, activated_at = now()
      where crest_account_id in (select id from crest_accounts where address = ${bytes(account)}) and policy_nonce = 2
      returning id, encode(content_hash, 'hex') as content_hash`;
    const staging = createEnrollment({ manifest, reader: { ...readerWithCode(code), readPolicyNonce: async () => 1n }, db });
    const replacement = { ...draft, debtCeilingAssets: "2200000000" };
    await expect(staging.stagePolicy(account, {
      owner, policy: replacement, intents, ownerSignature: await signedDraft(replacement, 2n),
    })).rejects.toMatchObject({ status: 409 });
    const [stillActive] = await client`select id, status, encode(content_hash, 'hex') as content_hash from policies where id = ${current?.id}`;
    expect(stillActive).toEqual({ id: current?.id, status: "active", content_hash: current?.content_hash });
  });
});
