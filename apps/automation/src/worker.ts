import { decodeFunctionData, getAddress, keccak256, type Abi, type Address, type Hex, type PublicClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { eq } from "drizzle-orm";
import { pinBlock, simulateCall } from "@crest/chain";
import { crestAccountAbi } from "@crest/contracts";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { automationRuns, automationTriggers, claimGuardianTrigger, closeGuardianClaim, crestAccounts,
  loadGuardianPendingAttempt, loadGuardianRecordedReceipt, markGuardianBroadcast, markGuardianReceiptReorged,
  networks, policies, recordGuardianAttempt, recordGuardianReconciliation, createDatabase } from "@crest/db";
import { canonicalJson } from "@crest/domain";
import { morphoRouteOf } from "@crest/morpho";
import { decodeGuardianReceipt } from "./reconcile.ts";
import { verifyGuardianPostconditions } from "./postconditions.ts";
import { buildGuardianCall } from "./simulate.ts";
import { readGuardianState, type GuardianRoute } from "./state.ts";
import { submitSignedGuardianCall } from "./submit.ts";
import { validateGuardianAction } from "./validate.ts";

type Database = ReturnType<typeof createDatabase>["db"];
type Result = { status: "no_trigger" | "pending" | "verified" | "failed" | "uncertain"; runId?: string; transactionHash?: Hex };

export function exactRoute(manifest: DeploymentManifest, account: Address, guardian: Address, codeHash: Hex): GuardianRoute {
  const route = morphoRouteOf(manifest);
  return { account, guardian, expectedCodeHash: codeHash,
    expectedMorphoCodeHash: manifest.contracts.morpho!.codeHash as Hex,
    expectedVaultCodeHash: manifest.vault.codeHash as Hex,
    expectedLoanCodeHash: manifest.contracts.loanToken!.codeHash as Hex,
    morpho: route.morpho, marketId: route.marketId, market: route.params,
    loanToken: route.params.loanToken, vault: getAddress(manifest.vault.address) };
}

async function freshBlock(rpc: PublicClient, expectedChainId: number) {
  const head = await pinBlock(rpc, { nowSeconds: BigInt(Math.floor(Date.now() / 1000)), maxHeadLagSeconds: 120n, expectedChainId });
  if (head.status !== "normal" || head.value === null) throw new Error("Custos refuses a stale or missing chain head");
  return head.value.block;
}

/** Explicit one-shot worker. Signing is loaded only after the reviewed account and policy pass fresh reads. */
export async function executeGuardianOnce(
  db: Database, rpc: PublicClient, manifest: DeploymentManifest,
  input: { triggerId: string; account: Address; guardian: Address; loadSigner: () => PrivateKeyAccount },
): Promise<Result> {
  if (await rpc.getChainId() !== manifest.network.chainId) throw new Error("Custos chain does not match the deployment manifest");
  const claim = await claimGuardianTrigger(db, {
    triggerId: input.triggerId, chainId: BigInt(manifest.network.chainId),
    accountAddress: input.account, guardianAddress: input.guardian, now: new Date(),
  });
  if (claim === null) return { status: "no_trigger" };
  let transactionHash: Hex | undefined;
  try {
    if (claim.marketId.toLowerCase() !== manifest.market.id.toLowerCase()) throw new Error("trigger market differs from reviewed market");
    const route = exactRoute(manifest, input.account, input.guardian, claim.accountCodeHash);
    const block = await freshBlock(rpc, manifest.network.chainId);
    const before = await readGuardianState(rpc, block, route, claim.actionKind === "freeze" ? "freeze" : "repay");
    const expected = { account: input.account, guardian: input.guardian, policyHash: claim.policyHash,
      marketId: claim.marketId, vault: route.vault };
    const action = validateGuardianAction(claim, before, expected);
    const call = buildGuardianCall(action, input.account);
    const simulation = await simulateCall(rpc, block, { from: input.guardian, to: call.to, data: call.data });
    if (simulation.status !== "normal" || simulation.value?.ok !== true) throw new Error("Guardian simulation failed at the pinned block");
    const signer = input.loadSigner();
    if (signer.address.toLowerCase() !== input.guardian.toLowerCase()) throw new Error("Guardian signer does not match onchain authority");
    const [gas, fees, nonce] = await Promise.all([
      rpc.estimateGas({ account: input.guardian, to: call.to, data: call.data, blockNumber: block.number }),
      rpc.estimateFeesPerGas(),
      rpc.getTransactionCount({ address: input.guardian, blockTag: "pending" }),
    ]);
    if (fees.maxFeePerGas === undefined || fees.maxPriorityFeePerGas === undefined) throw new Error("EIP-1559 fees unavailable");
    let attemptId: string | undefined;
    const submitted = await submitSignedGuardianCall({ signer, call, expectedAccount: input.account,
      transaction: { chainId: manifest.network.chainId, nonce, gas, maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas },
      persist: async (hash) => {
        transactionHash = hash;
        attemptId = await recordGuardianAttempt(db, {
          runId: claim.runId, chainId: BigInt(manifest.network.chainId), accountId: claim.accountId,
          from: input.guardian, to: input.account, selector: call.selector as "freezeBorrowing()" | "repayFromReserve(uint256)" | "repayFromStrategy(uint256)",
          calldataHash: keccak256(call.data), simulationBlockNumber: block.number, simulationBlockHash: block.hash, simulationGas: gas,
          nonce: BigInt(nonce), transactionHash: hash,
        });
      },
      broadcast: (raw) => rpc.sendRawTransaction({ serializedTransaction: raw }),
    });
    if (!attemptId) throw new Error("Guardian signed attempt was not durably recorded");
    await markGuardianBroadcast(db, attemptId);
    return await reconcileGuardianRun(db, rpc, manifest, claim.runId, { account: input.account, guardian: input.guardian })
      ?? { status: "pending", runId: claim.runId, transactionHash: submitted.hash };
  } catch {
    if (!transactionHash) {
      await closeGuardianClaim(db, { runId: claim.runId, status: "failed", reason: "pre_sign_validation_or_simulation", now: new Date() });
      return { status: "failed", runId: claim.runId };
    }
    // After a hash is computed, an uncertain database write or send cannot justify automatic retry.
    return { status: "uncertain", runId: claim.runId, transactionHash };
  }
}

/** Reconcile a previously signed run without ever loading the key or resending bytes. */
export async function reconcileGuardianRun(
  db: Database, rpc: PublicClient, manifest: DeploymentManifest, runId: string,
  expected: { account: Address; guardian: Address },
): Promise<Result | null> {
  if (await rpc.getChainId() !== manifest.network.chainId) throw new Error("Custos reconciliation chain changed");
  const recorded = await loadGuardianRecordedReceipt(db, runId);
  if (recorded?.canonical) {
    if (recorded.accountAddress.toLowerCase() !== expected.account.toLowerCase() ||
      recorded.guardianAddress.toLowerCase() !== expected.guardian.toLowerCase()) {
      throw new Error("Custos recorded receipt identity changed");
    }
    const observed = await rpc.getBlock({ blockNumber: recorded.blockNumber });
    if (!observed.hash) throw new Error("Custos cannot verify recorded receipt block");
    if (observed.hash.toLowerCase() !== recorded.blockHash.toLowerCase()) {
      const recovery = await markGuardianReceiptReorged(db, runId, recorded.attemptId, recorded.blockHash, new Date());
      if (recovery === "conflict") return { status: "uncertain", runId, transactionHash: recorded.transactionHash };
    } else {
      if (recorded.status !== "completed" && recorded.status !== "failed") throw new Error("Custos canonical receipt has inconsistent run status");
      return { status: recorded.status === "completed" ? "verified" : "failed",
        runId, transactionHash: recorded.transactionHash };
    }
  }
  const pending = await loadGuardianPendingAttempt(db, runId);
  if (!pending) return null;
  const hash = pending.transactionHash;
  if (pending.accountAddress.toLowerCase() !== expected.account.toLowerCase() ||
    pending.guardianAddress.toLowerCase() !== expected.guardian.toLowerCase()) throw new Error("Custos pending attempt identity changed");
  const pendingResult: Result = { status: "pending", runId, transactionHash: hash };
  const [tx, receipt] = await Promise.all([
    rpc.getTransaction({ hash }).catch(() => null),
    rpc.getTransactionReceipt({ hash }).catch(() => null),
  ]);
  if (!tx || !receipt) return pendingResult;
  if (tx.hash.toLowerCase() !== hash.toLowerCase() || keccak256(tx.input).toLowerCase() !== pending.calldataHash.toLowerCase() ||
    tx.from.toLowerCase() !== expected.guardian.toLowerCase() || tx.to?.toLowerCase() !== expected.account.toLowerCase()) {
    throw new Error("Custos signed transaction evidence changed");
  }
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error("Custos receipt transaction hash changed");
  const simulated = await rpc.getBlock({ blockNumber: pending.simulationBlockNumber });
  if (simulated.hash?.toLowerCase() !== pending.simulationBlockHash.toLowerCase()) {
    throw new Error("Custos simulation block reorged; historical pre-state is not attributable");
  }
  const [network] = await db.select({ depth: networks.confirmationDepth }).from(networks)
    .where(eq(networks.chainId, BigInt(manifest.network.chainId)));
  if (!network) throw new Error("Custos network is not registered");
  const head = await freshBlock(rpc, manifest.network.chainId);
  if (head.number < receipt.blockNumber + BigInt(network.depth)) return pendingResult;
  const mined = await rpc.getBlock({ blockNumber: receipt.blockNumber });
  if (mined.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return pendingResult;
  if (receipt.status !== "success") {
    await recordGuardianReconciliation(db, { runId, attemptId: pending.attemptId,
      receipt: { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, canonical: true, success: false,
        gasUsed: receipt.gasUsed, decodedEvents: [] }, checks: [],
      checkedBlock: { number: receipt.blockNumber, hash: receipt.blockHash }, now: new Date() });
    return { status: "failed", runId, transactionHash: hash };
  }
  const [binding] = await db.select({ codeHash: crestAccounts.codeHash, policyHash: policies.policyHash,
    marketId: policies.marketId }).from(automationRuns)
    .innerJoin(automationTriggers, eq(automationTriggers.id, automationRuns.triggerId))
    .innerJoin(policies, eq(policies.id, automationTriggers.policyId))
    .innerJoin(crestAccounts, eq(crestAccounts.id, policies.crestAccountId))
    .where(eq(automationRuns.id, runId));
  if (!binding?.policyHash) throw new Error("Custos run has no bound policy evidence");
  const route = exactRoute(manifest, expected.account, expected.guardian, `0x${Buffer.from(binding.codeHash).toString("hex")}` as Hex);
  const mode = pending.actionKind === "freeze" ? "freeze" : "repay";
  const before = await readGuardianState(rpc, { number: simulated.number!, hash: simulated.hash!, timestamp: simulated.timestamp }, route, mode);
  const after = await readGuardianState(rpc, { number: receipt.blockNumber, hash: receipt.blockHash, timestamp: mined.timestamp }, route, mode);
  const [simulationStillCanonical, receiptStillCanonical] = await Promise.all([
    rpc.getBlock({ blockNumber: pending.simulationBlockNumber }), rpc.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  if (simulationStillCanonical.hash?.toLowerCase() !== pending.simulationBlockHash.toLowerCase() ||
    receiptStillCanonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    throw new Error("Custos chain reorged during post-state reads");
  }
  const action = validateGuardianAction(pending, before, { account: expected.account, guardian: expected.guardian,
    policyHash: `0x${Buffer.from(binding.policyHash).toString("hex")}` as Hex,
    marketId: `0x${Buffer.from(binding.marketId).toString("hex")}` as Hex, vault: route.vault });
  const decoded = decodeFunctionData({ abi: crestAccountAbi as Abi, data: tx.input });
  const call = buildGuardianCall(action, expected.account);
  if (tx.input.toLowerCase() !== call.data.toLowerCase() || decoded.functionName !== call.selector.slice(0, call.selector.indexOf("("))) {
    throw new Error("Custos mined calldata differs from authorized action");
  }
  const evidence = decodeGuardianReceipt(receipt, { account: expected.account, guardian: expected.guardian,
    morpho: route.morpho, vault: route.vault, marketId: route.marketId }, action.kind);
  const checks = verifyGuardianPostconditions({ action, before, after, receipt: evidence });
  await recordGuardianReconciliation(db, { runId, attemptId: pending.attemptId,
    receipt: { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, canonical: true, success: true,
      gasUsed: receipt.gasUsed, decodedEvents: JSON.parse(canonicalJson(evidence)) },
    checks, checkedBlock: { number: receipt.blockNumber, hash: receipt.blockHash }, now: new Date() });
  return { status: checks.every((check) => check.passed) ? "verified" : "failed", runId, transactionHash: hash };
}

