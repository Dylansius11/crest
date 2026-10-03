import { sql } from "drizzle-orm";
import { getAddress } from "viem";
import type { Address } from "viem";

import { validateDeploymentManifest } from "@crest/contracts/manifest";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { createDatabase } from "@crest/db";
import { compilePolicy, routeContextOf } from "@crest/policy";
import type { CompiledPolicy } from "@crest/policy";

interface ActivePolicyRow {
  accountId: string;
  ownerAddress: string;
  accountAddress: string;
  deploymentBlock: bigint | string;
  confirmationDepth: number;
  policyId: string;
  vaultDeploymentId: string;
  nonce: bigint | string;
  typedJson: unknown;
  contentHash: string;
  policyHash: string;
  effectiveBlock: bigint | string;
  effectiveBlockHash: string;
  registryChainId: bigint | string;
  marketId: string;
  morphoAddress: string;
  loanAddress: string;
  collateralAddress: string;
  oracleAddress: string;
  irmAddress: string;
  marketLltv: bigint | string;
  vaultAddress: string;
  vaultAssetAddress: string;
  morphoCodeHash: string;
  loanCodeHash: string;
  collateralCodeHash: string;
  vaultCodeHash: string;
}

/**
 * Loads the sole owner policy that the canonical PolicyConfigured event activated on the reviewed route.
 * Any missing, stale, reorged, ambiguous, or mismatched evidence fails closed.
 */
export async function loadMonitoredPolicy(
  db: ReturnType<typeof createDatabase>["db"],
  manifest: DeploymentManifest,
  address: Address,
  finalizedBlock: bigint,
): Promise<{ accountId: string; policyId: string; vaultDeploymentId: string; compiled: CompiledPolicy; nonce: bigint; deploymentBlock: bigint; confirmationDepth: number }> {
  const manifestErrors = validateDeploymentManifest(manifest);
  if (manifestErrors.length > 0) throw new Error(`deployment manifest is invalid: ${manifestErrors.join("; ")}`);

  const account = getAddress(address);
  const rows = await db.execute(sql`
    select
      ca.id as "accountId",
      encode(o.address, 'hex') as "ownerAddress",
      encode(ca.address, 'hex') as "accountAddress",
      ca.deployment_block_number as "deploymentBlock",
      n.confirmation_depth as "confirmationDepth",
      p.id as "policyId",
      p.vault_deployment_id as "vaultDeploymentId",
      p.policy_nonce as nonce,
      p.typed_json as "typedJson",
      encode(p.content_hash, 'hex') as "contentHash",
      encode(p.policy_hash, 'hex') as "policyHash",
      p.effective_block_number as "effectiveBlock",
      encode(p.effective_block_hash, 'hex') as "effectiveBlockHash",
      ca.chain_id as "registryChainId",
      encode(mm.id, 'hex') as "marketId",
      encode(md.address, 'hex') as "morphoAddress",
      encode(loan.address, 'hex') as "loanAddress",
      encode(collateral.address, 'hex') as "collateralAddress",
      encode(mm.oracle_address, 'hex') as "oracleAddress",
      encode(mm.irm_address, 'hex') as "irmAddress",
      mm.lltv_wad as "marketLltv",
      encode(vd.address, 'hex') as "vaultAddress",
      encode(vault_asset.address, 'hex') as "vaultAssetAddress",
      encode(md.code_hash, 'hex') as "morphoCodeHash",
      encode(loan.code_hash, 'hex') as "loanCodeHash",
      encode(collateral.code_hash, 'hex') as "collateralCodeHash",
      encode(vd.code_hash, 'hex') as "vaultCodeHash"
    from crest_accounts ca
    join owners o on o.id = ca.owner_id
    join networks n on n.chain_id = ca.chain_id
    join policies p on p.crest_account_id = ca.id
    join morpho_markets mm on mm.id = p.market_id and mm.loan_token_id = p.loan_token_id
    join morpho_deployments md on md.id = mm.morpho_deployment_id and md.chain_id = ca.chain_id
    join token_deployments loan on loan.id = p.loan_token_id and loan.chain_id = ca.chain_id
    join token_deployments collateral on collateral.id = mm.collateral_token_id and collateral.chain_id = ca.chain_id
    join vault_deployments vd on vd.id = p.vault_deployment_id and vd.asset_token_id = p.loan_token_id and vd.chain_id = ca.chain_id
    join token_deployments vault_asset on vault_asset.id = vd.asset_token_id and vault_asset.chain_id = ca.chain_id
    join canonical_account_events cae on cae.crest_account_id = ca.id
      and cae.event_kind = 'PolicyConfigured'
      and cae.canonical
      and cae.reorged_at is null
      and cae.block_number = p.effective_block_number
      and cae.block_hash = p.effective_block_hash
      and cae.payload_json ->> 'policyNonce' = p.policy_nonce::text
      and lower(cae.payload_json ->> 'policyHash') = '0x' || encode(p.policy_hash, 'hex')
      and lower(cae.payload_json ->> 'marketId') = '0x' || encode(p.market_id, 'hex')
      and lower(cae.payload_json ->> 'yieldVault') = '0x' || encode(vd.address, 'hex')
    where ca.address = ${Buffer.from(account.slice(2), "hex")}
      and ca.chain_id = ${BigInt(manifest.network.chainId)}
      and ca.status = 'active'
      and n.enabled
      and p.status = 'active'
      and (select count(*) from policies active where active.crest_account_id = ca.id and active.status = 'active') = 1
      and p.policy_hash is not null
      and p.effective_block_number is not null
      and p.effective_block_hash is not null
      and p.effective_block_number <= ${finalizedBlock}
      and ca.deployment_block_number <= ${finalizedBlock}
      and ca.indexed_policy_nonce = p.policy_nonce
  `) as unknown as { rows?: ActivePolicyRow[] } | ActivePolicyRow[];
  const policies = Array.isArray(rows) ? rows : rows.rows ?? [];
  if (policies.length !== 1) throw new Error(`expected exactly one canonically activated policy; found ${policies.length}`);
  const [policy] = policies;
  if (policy === undefined) throw new Error("active policy query returned no row");

  const owner = getAddress(`0x${policy.ownerAddress}`);
  const route = routeContextOf(manifest, { account, owner });
  const expected = {
    registryChainId: BigInt(manifest.network.chainId).toString(),
    accountAddress: account.slice(2).toLowerCase(),
    marketId: route.marketId.slice(2).toLowerCase(),
    morphoAddress: route.morpho.slice(2).toLowerCase(),
    loanAddress: route.market.loanToken.slice(2).toLowerCase(),
    collateralAddress: route.market.collateralToken.slice(2).toLowerCase(),
    oracleAddress: route.market.oracle.slice(2).toLowerCase(),
    irmAddress: route.market.irm.slice(2).toLowerCase(),
    marketLltv: route.market.lltv.toString(),
    vaultAddress: route.vault.slice(2).toLowerCase(),
    vaultAssetAddress: route.market.loanToken.slice(2).toLowerCase(),
    morphoCodeHash: manifest.contracts.morpho!.codeHash.slice(2).toLowerCase(),
    loanCodeHash: manifest.contracts.loanToken!.codeHash.slice(2).toLowerCase(),
    collateralCodeHash: manifest.contracts.collateralToken!.codeHash.slice(2).toLowerCase(),
    vaultCodeHash: manifest.vault.codeHash.slice(2).toLowerCase(),
  };
  const actual = {
    registryChainId: BigInt(policy.registryChainId).toString(),
    accountAddress: policy.accountAddress.toLowerCase(),
    marketId: policy.marketId.toLowerCase(),
    morphoAddress: policy.morphoAddress.toLowerCase(),
    loanAddress: policy.loanAddress.toLowerCase(),
    collateralAddress: policy.collateralAddress.toLowerCase(),
    oracleAddress: policy.oracleAddress.toLowerCase(),
    irmAddress: policy.irmAddress.toLowerCase(),
    marketLltv: BigInt(policy.marketLltv).toString(),
    vaultAddress: policy.vaultAddress.toLowerCase(),
    vaultAssetAddress: policy.vaultAssetAddress.toLowerCase(),
    morphoCodeHash: policy.morphoCodeHash.toLowerCase(),
    loanCodeHash: policy.loanCodeHash.toLowerCase(),
    collateralCodeHash: policy.collateralCodeHash.toLowerCase(),
    vaultCodeHash: policy.vaultCodeHash.toLowerCase(),
  };
  if (Object.entries(expected).some(([key, value]) => actual[key as keyof typeof actual] !== value)) {
    throw new Error("active policy registry route or code evidence does not match the deployment manifest");
  }

  const draft = typeof policy.typedJson === "string" ? JSON.parse(policy.typedJson) : policy.typedJson;
  const result = compilePolicy(draft, route);
  if (!result.ok) throw new Error(`stored policy draft is invalid: ${result.issues.join("; ")}`);
  const compiled = result.policy;
  if (compiled.contentHash.slice(2).toLowerCase() !== policy.contentHash.toLowerCase()) {
    throw new Error("stored policy content hash does not match its compiled draft");
  }
  if (compiled.policyHash.slice(2).toLowerCase() !== policy.policyHash.toLowerCase()) {
    throw new Error("stored policy hash does not match its compiled configuration");
  }

  return {
    accountId: policy.accountId,
    policyId: policy.policyId,
    vaultDeploymentId: policy.vaultDeploymentId,
    compiled,
    nonce: BigInt(policy.nonce),
    deploymentBlock: BigInt(policy.deploymentBlock),
    confirmationDepth: policy.confirmationDepth,
  };
}
