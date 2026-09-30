import { fileURLToPath } from "node:url";
import { encodeEventTopics, getAddress, keccak256, parseAbi, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import type { GuardianState } from "./validate.ts";
import { buildGuardianCall } from "./simulate.ts";

const repository = vi.hoisted(() => ({
  claimGuardianTrigger: vi.fn(), closeGuardianClaim: vi.fn(), recordGuardianAttempt: vi.fn(),
  markGuardianBroadcast: vi.fn(), loadGuardianPendingAttempt: vi.fn(), recordGuardianReconciliation: vi.fn(),
  loadGuardianRecordedReceipt: vi.fn(), markGuardianReceiptReorged: vi.fn(),
}));
const chain = vi.hoisted(() => ({ pinBlock: vi.fn(), simulateCall: vi.fn() }));
const state = vi.hoisted(() => ({ readGuardianState: vi.fn() }));
vi.mock("@crest/db", async (original) => ({ ...await original(), ...repository }));
vi.mock("@crest/chain", async (original) => ({ ...await original(), ...chain }));
vi.mock("./state.ts", async (original) => ({ ...await original(), ...state }));

import { executeGuardianOnce, reconcileGuardianRun } from "./worker.ts";

const key = `0x${"01".repeat(32)}` as Hex;
const signer = privateKeyToAccount(key);
const guardian = signer.address;
const account = getAddress("0x2222222222222222222222222222222222222222");
const block = { number: 100n, hash: `0x${"a1".repeat(32)}` as Hex, timestamp: BigInt(Math.floor(Date.now() / 1000)) };
const policyHash = `0x${"11".repeat(32)}` as Hex;
const manifestPath = fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url));
const manifest = await loadDeploymentManifest(manifestPath);
const claim = { runId: "11111111-1111-4111-8111-111111111111", triggerId: "trigger-1", actionKind: "freeze",
  requestedAssets: null, policyNonce: 7n, policyHash, marketId: manifest.market.id,
  accountCodeHash: `0x${"0f".repeat(32)}`, accountId: "22222222-2222-4222-8222-222222222222" };
const before: GuardianState = {
  block, account, guardian, policyNonce: 7n, policyHash, marketId: manifest.market.id as Hex,
  vault: getAddress(manifest.vault.address), debtAssets: 50n, reserveAssets: 100n, shares: 30n,
  strategyAssets: 40n, withdrawableAssets: 30n, frozen: false,
  reserveFloorAssets: 10n, strategyFloorAssets: 10n, maxRepayPerActionAssets: 25n,
};
const rpc = {
  getChainId: vi.fn(async () => 4663), estimateGas: vi.fn(async () => 100_000n),
  estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 2n, maxPriorityFeePerGas: 1n })),
  getTransactionCount: vi.fn(async () => 1),
  sendRawTransaction: vi.fn(async ({ serializedTransaction }: { serializedTransaction: Hex }) => keccak256(serializedTransaction)),
  getTransaction: vi.fn(async () => null as unknown), getTransactionReceipt: vi.fn(async () => null as unknown),
  getBlock: vi.fn(async (_options?: { blockNumber: bigint }) => ({ number: block.number, hash: `0x${"ee".repeat(32)}`, timestamp: block.timestamp })),
};
const database = {} as Parameters<typeof executeGuardianOnce>[0];
const client = rpc as unknown as PublicClient;

beforeEach(() => {
  vi.clearAllMocks();
  repository.claimGuardianTrigger.mockResolvedValue(claim);
  repository.recordGuardianAttempt.mockResolvedValue("33333333-3333-4333-8333-333333333333");
  repository.loadGuardianPendingAttempt.mockResolvedValue(null);
  chain.pinBlock.mockResolvedValue({ status: "normal", value: { block } });
  repository.loadGuardianRecordedReceipt.mockResolvedValue(null);
  chain.simulateCall.mockResolvedValue({ status: "normal", value: { ok: true } });
  state.readGuardianState.mockResolvedValue(before);
  rpc.sendRawTransaction.mockImplementation(async ({ serializedTransaction }) => keccak256(serializedTransaction));
  rpc.getTransaction.mockResolvedValue(null);
  rpc.getTransactionReceipt.mockResolvedValue(null);
});

describe("Custos one-shot execution", () => {
  test("persists the signed hash before broadcasting, then declines a duplicate trigger", async () => {
    let recordedHash: Hex | undefined;
    repository.recordGuardianAttempt.mockImplementation(async (_db, input) => {
      recordedHash = input.transactionHash;
      return "33333333-3333-4333-8333-333333333333";
    });
    rpc.sendRawTransaction.mockImplementation(async ({ serializedTransaction }) => {
      expect(recordedHash).toBe(keccak256(serializedTransaction));
      return keccak256(serializedTransaction);
    });
    const first = await executeGuardianOnce(database, client, manifest, { triggerId: claim.triggerId, account, guardian, loadSigner: () => signer });
    expect(first).toEqual({ status: "pending", runId: claim.runId, transactionHash: recordedHash });
    expect(repository.recordGuardianAttempt).toHaveBeenCalledOnce();
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
    repository.claimGuardianTrigger.mockResolvedValueOnce(null);
    const second = await executeGuardianOnce(database, client, manifest, { triggerId: claim.triggerId, account, guardian, loadSigner: () => { throw new Error("duplicate loaded key"); } });
    expect(second).toEqual({ status: "no_trigger" });
    expect(rpc.sendRawTransaction).toHaveBeenCalledOnce();
  });

  test("a failed broadcast remains uncertain and a restart reconciles by hash without signing or resending", async () => {
    rpc.sendRawTransaction.mockRejectedValueOnce(new Error("network lost after send"));
    const first = await executeGuardianOnce(database, client, manifest, { triggerId: claim.triggerId, account, guardian, loadSigner: () => signer });
    expect(first.status).toBe("uncertain");
    expect(first.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    const sent = rpc.sendRawTransaction.mock.calls.length;
    repository.loadGuardianPendingAttempt.mockResolvedValueOnce({ runId: claim.runId, transactionHash: first.transactionHash,
      accountAddress: account, guardianAddress: guardian });
    expect(await reconcileGuardianRun(database, client, manifest, claim.runId, { account, guardian })).toEqual({
      status: "pending", runId: claim.runId, transactionHash: first.transactionHash,
    });
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(sent);
  });

  test("a changed policy closes without loading a key or touching the chain sender", async () => {
    state.readGuardianState.mockResolvedValueOnce({ ...before, policyNonce: 8n });
    const result = await executeGuardianOnce(database, client, manifest, { triggerId: claim.triggerId, account, guardian,
      loadSigner: () => { throw new Error("should not load signer"); } });
    expect(result).toEqual({ status: "failed", runId: claim.runId });
    expect(repository.closeGuardianClaim).toHaveBeenCalledWith(database, expect.objectContaining({ runId: claim.runId, status: "failed" }));
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  test("a signer failure before any signed hash closes the claim without broadcast", async () => {
    const brokenSigner = { ...signer, signTransaction: async () => { throw new Error("signing unavailable"); } };
    const result = await executeGuardianOnce(database, client, manifest, { triggerId: claim.triggerId, account, guardian,
      loadSigner: () => brokenSigner });
    expect(result).toEqual({ status: "failed", runId: claim.runId });
    expect(repository.closeGuardianClaim).toHaveBeenCalledWith(database, expect.objectContaining({ runId: claim.runId, status: "failed" }));
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  test("a reorg of the simulated block cannot be reconciled against substitute history", async () => {
    const call = buildGuardianCall({ kind: "freeze" }, account);
    const hash = `0x${"ab".repeat(32)}` as Hex;
    repository.loadGuardianPendingAttempt.mockResolvedValueOnce({
      runId: claim.runId, transactionHash: hash, accountAddress: account, guardianAddress: guardian,
      calldataHash: keccak256(call.data), simulationBlockNumber: block.number, simulationBlockHash: block.hash,
    });
    rpc.getTransaction.mockResolvedValueOnce({ hash, input: call.data, from: guardian, to: account });
    rpc.getTransactionReceipt.mockResolvedValueOnce({ transactionHash: hash, blockNumber: block.number + 1n });
    await expect(reconcileGuardianRun(database, client, manifest, claim.runId, { account, guardian }))
      .rejects.toThrow("simulation block reorged");
    expect(repository.recordGuardianReconciliation).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  test("a finalized reverted receipt records failure and does not send another transaction", async () => {
    const call = buildGuardianCall({ kind: "freeze" }, account);
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const receiptHash = `0x${"ce".repeat(32)}` as Hex;
    repository.loadGuardianPendingAttempt.mockResolvedValueOnce({
      runId: claim.runId, attemptId: "33333333-3333-4333-8333-333333333333",
      transactionHash: hash, accountAddress: account, guardianAddress: guardian,
      calldataHash: keccak256(call.data), simulationBlockNumber: block.number, simulationBlockHash: block.hash,
    });
    rpc.getTransaction.mockResolvedValueOnce({ hash, input: call.data, from: guardian, to: account });
    rpc.getTransactionReceipt.mockResolvedValueOnce({
      transactionHash: hash, blockNumber: 101n, blockHash: receiptHash, status: "reverted", gasUsed: 100_000n,
    });
    rpc.getBlock.mockImplementationOnce(async () => block).mockImplementationOnce(async () =>
      ({ ...block, number: 101n, hash: receiptHash }));
    chain.pinBlock.mockResolvedValueOnce({ status: "normal", value: { block: { ...block, number: 103n } } });
    const confirmed = { select: () => ({ from: () => ({ where: async () => [{ depth: 1 }] }) }) };
    const result = await reconcileGuardianRun(confirmed as unknown as typeof database, client, manifest, claim.runId, { account, guardian });
    expect(result).toEqual({ status: "failed", runId: claim.runId, transactionHash: hash });
    expect(repository.recordGuardianReconciliation).toHaveBeenCalledWith(confirmed,
      expect.objectContaining({ receipt: expect.objectContaining({ success: false, canonical: true }), checks: [] }));
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  test("an orphaned recorded receipt reopens the same signed hash for keyless reconciliation", async () => {
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const oldBlockHash = `0x${"cd".repeat(32)}` as Hex;
    repository.loadGuardianRecordedReceipt.mockResolvedValueOnce({
      attemptId: "33333333-3333-4333-8333-333333333333", transactionHash: hash,
      accountAddress: account, guardianAddress: guardian, status: "completed",
      blockNumber: 101n, blockHash: oldBlockHash, canonical: true,
    });
    rpc.getBlock.mockResolvedValueOnce({ ...block, number: 101n, hash: `0x${"ee".repeat(32)}` });
    repository.loadGuardianPendingAttempt.mockResolvedValueOnce({
      runId: claim.runId, transactionHash: hash, accountAddress: account, guardianAddress: guardian,
    });
    const result = await reconcileGuardianRun(database, client, manifest, claim.runId, { account, guardian });
    expect(result).toEqual({ status: "pending", runId: claim.runId, transactionHash: hash });
    expect(repository.markGuardianReceiptReorged).toHaveBeenCalledWith(database, claim.runId,
      "33333333-3333-4333-8333-333333333333", oldBlockHash, expect.any(Date));
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  test("a reorg with another active signer reports uncertainty without claiming it is verified", async () => {
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const oldBlockHash = `0x${"cd".repeat(32)}` as Hex;
    repository.loadGuardianRecordedReceipt.mockResolvedValueOnce({
      attemptId: "33333333-3333-4333-8333-333333333333", transactionHash: hash,
      accountAddress: account, guardianAddress: guardian, status: "completed",
      blockNumber: 101n, blockHash: oldBlockHash, canonical: true,
    });
    rpc.getBlock.mockResolvedValueOnce({ ...block, number: 101n, hash: `0x${"ee".repeat(32)}` });
    repository.markGuardianReceiptReorged.mockResolvedValueOnce("conflict");
    expect(await reconcileGuardianRun(database, client, manifest, claim.runId, { account, guardian }))
      .toEqual({ status: "uncertain", runId: claim.runId, transactionHash: hash });
    expect(repository.loadGuardianPendingAttempt).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  test("a recorded canonical receipt remains verified without replay or another send", async () => {
    const hash = `0x${"ab".repeat(32)}` as Hex;
    repository.loadGuardianRecordedReceipt.mockResolvedValueOnce({
      attemptId: "33333333-3333-4333-8333-333333333333", transactionHash: hash,
      accountAddress: account, guardianAddress: guardian, status: "completed",
      blockNumber: 101n, blockHash: block.hash, canonical: true,
    });
    rpc.getBlock.mockResolvedValueOnce({ ...block, number: 101n });
    expect(await reconcileGuardianRun(database, client, manifest, claim.runId, { account, guardian }))
      .toEqual({ status: "verified", runId: claim.runId, transactionHash: hash });
    expect(repository.loadGuardianPendingAttempt).not.toHaveBeenCalled();
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  test("a confirmed freeze records canonical post-state without reading broken vault liquidity", async () => {
    const call = buildGuardianCall({ kind: "freeze" }, account);
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const receiptHash = `0x${"ce".repeat(32)}` as Hex;
    repository.loadGuardianPendingAttempt.mockResolvedValueOnce({
      runId: claim.runId, attemptId: "33333333-3333-4333-8333-333333333333",
      transactionHash: hash, accountAddress: account, guardianAddress: guardian,
      calldataHash: keccak256(call.data), simulationBlockNumber: block.number, simulationBlockHash: block.hash,
      requestedAssets: null, actionKind: "freeze", policyNonce: 7n,
    });
    rpc.getTransaction.mockResolvedValueOnce({ hash, input: call.data, from: guardian, to: account });
    const frozenEvent = parseAbi(["event BorrowingFrozen(address indexed actor,uint64 indexed policyNonce)"]);
    rpc.getTransactionReceipt.mockResolvedValueOnce({ transactionHash: hash, blockNumber: 101n,
      blockHash: receiptHash, status: "success", from: guardian, to: account, gasUsed: 100_000n,
      logs: [{ address: account, topics: encodeEventTopics({ abi: frozenEvent, eventName: "BorrowingFrozen",
        args: { actor: guardian, policyNonce: 7n } }), data: "0x", logIndex: 0 }] });
    rpc.getBlock.mockImplementation(async (options?: { blockNumber: bigint }) =>
      options?.blockNumber === 100n ? block : { ...block, number: 101n, hash: receiptHash });
    chain.pinBlock.mockResolvedValueOnce({ status: "normal", value: { block: { ...block, number: 103n } } });
    state.readGuardianState.mockResolvedValueOnce({ ...before, reserveAssets: null, strategyAssets: null,
      withdrawableAssets: null, shares: null }).mockResolvedValueOnce({ ...before, frozen: true,
      reserveAssets: null, strategyAssets: null, withdrawableAssets: null, shares: null });
    const binding = { codeHash: Buffer.from("0f".repeat(32), "hex"),
      policyHash: Buffer.from(policyHash.slice(2), "hex"), marketId: Buffer.from(manifest.market.id.slice(2), "hex") };
    const where = { where: async () => [{ depth: 1 }] };
    const routeWhere = { where: async () => [binding] };
    const confirmed = { select: vi.fn()
      .mockReturnValueOnce({ from: () => where })
      .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ innerJoin: () => ({
        innerJoin: () => routeWhere }) }) }) }) };
    const result = await reconcileGuardianRun(confirmed as unknown as typeof database, client, manifest, claim.runId, { account, guardian });
    expect(result).toEqual({ status: "verified", runId: claim.runId, transactionHash: hash });
    expect(repository.recordGuardianReconciliation).toHaveBeenCalledWith(confirmed,
      expect.objectContaining({ receipt: expect.objectContaining({ canonical: true, success: true }),
        checks: [expect.objectContaining({ kind: "frozen", passed: true })] }));
    expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
  });


});
