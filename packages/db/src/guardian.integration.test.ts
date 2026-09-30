import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createDatabase } from "./client.ts";
import {
  claimGuardianTrigger,
  closeGuardianClaim,
  loadGuardianPendingAttempt,
  loadGuardianRecordedReceipt,
  markGuardianBroadcast,
  recordGuardianAttempt,
  markGuardianReceiptReorged,
  recordGuardianReconciliation,
} from "./guardian.ts";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const { client, db } = createDatabase(databaseUrl);
const bytes = (hex: string, length: number) => Buffer.from(hex.repeat(length), "hex");
const address = (hex: string) => `0x${hex.repeat(20)}` as `0x${string}`;
const hash = (hex: string) => `0x${hex.repeat(32)}` as `0x${string}`;
const now = new Date("2026-09-30T12:00:00.000Z");
const databaseNow = now.toISOString();

interface Fixture {
  account: string;
  accountAddress: `0x${string}`;
  guardianAddress: `0x${string}`;
  policy: string;
  trigger: string;
  assessment: string;
}

async function fixture(
  actionKind: "freeze" | "repay_reserve" | "repay_strategy" = "freeze",
  guardianIdentity?: `0x${string}`,
): Promise<Fixture> {
  const id = {
    loanAsset: randomUUID(), collateralAsset: randomUUID(), loanToken: randomUUID(), collateralToken: randomUUID(),
    morpho: randomUUID(), vault: randomUUID(), owner: randomUUID(), account: randomUUID(), policy: randomUUID(),
    snapshot: randomUUID(), assessment: `assessment-${randomUUID()}`, trigger: `trigger-${randomUUID()}`,
  };
  const identity = (hex: string, length: number) => {
    const result = bytes(hex, length);
    Buffer.from(id.account.replaceAll("-", ""), "hex").copy(result, 0, 0, Math.min(16, length));
    return result;
  };
  const accountAddress = `0x${id.account.replaceAll("-", "")}${"aa".repeat(4)}` as `0x${string}`;
  const guardianAddress = guardianIdentity ?? `0x${id.account.replaceAll("-", "")}${"ab".repeat(4)}` as `0x${string}`;
  const blockHash = bytes("01", 32);
  const marketId = identity("02", 32);

  await client`insert into networks (chain_id, slug, name, native_symbol, confirmation_depth, enabled)
    values (4663, ${`guardian-${id.account}`}, 'Guardian Test', 'ETH', 1, true) on conflict (chain_id) do nothing`;
  await client`insert into assets (id, canonical_symbol, kind, metadata_json) values
    (${id.loanAsset}, ${`USDG-${id.account}`}, 'stablecoin', '{}'::jsonb),
    (${id.collateralAsset}, ${`AAPL-${id.account}`}, 'stock_token', '{}'::jsonb)`;
  await client`insert into token_deployments
    (id, asset_id, chain_id, address, decimals, code_hash, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values
    (${id.loanToken}, ${id.loanAsset}, 4663, ${identity("03", 20)}, 6, ${bytes("04", 32)}, 'https://example.test/loan', 1, ${blockHash}, ${databaseNow}, 'verified'),
    (${id.collateralToken}, ${id.collateralAsset}, 4663, ${identity("05", 20)}, 18, ${bytes("06", 32)}, 'https://example.test/collateral', 1, ${blockHash}, ${databaseNow}, 'verified')`;
  await client`insert into morpho_deployments
    (id, chain_id, address, code_hash, version, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.morpho}, 4663, ${identity("07", 20)}, ${bytes("08", 32)}, 'blue', 'https://example.test/morpho', 1, ${blockHash}, ${databaseNow}, 'verified')`;
  await client`insert into morpho_markets
    (id, morpho_deployment_id, loan_token_id, collateral_token_id, oracle_address, irm_address, lltv_wad, params_hash_verified, status, verified_at)
    values (${marketId}, ${id.morpho}, ${id.loanToken}, ${id.collateralToken}, ${bytes("09", 20)}, ${bytes("0a", 20)}, 900000000000000000, true, 'verified', ${databaseNow})`;
  await client`insert into vault_deployments
    (id, chain_id, address, asset_token_id, share_decimals, interface_kind, code_hash, upgradeability_kind, manager_json, source_url, verified_block_number, verified_block_hash, verified_at, status)
    values (${id.vault}, 4663, ${identity("0b", 20)}, ${id.loanToken}, 18, 'fixed_adapter', ${bytes("0c", 32)}, 'none', '{}'::jsonb, 'https://example.test/vault', 1, ${blockHash}, ${databaseNow}, 'verified')`;
  await client`insert into owners (id, address, first_seen_at, last_seen_at)
    values (${id.owner}, ${identity("0d", 20)}, ${databaseNow}, ${databaseNow})`;
  await client`insert into crest_accounts
    (id, chain_id, address, owner_id, deployment_transaction_hash, deployment_block_number, contract_version, code_hash, indexed_policy_nonce, status)
    values (${id.account}, 4663, ${Buffer.from(accountAddress.slice(2), "hex")}, ${id.owner}, ${bytes("0e", 32)}, 1, '1', ${bytes("0f", 32)}, 7, 'active')`;
  await client`insert into policies
    (id, crest_account_id, policy_nonce, schema_version, typed_json, content_hash, policy_hash, source, status, market_id, vault_deployment_id, loan_token_id, market_lltv_wad, effective_block_number, effective_block_hash, activated_at)
    values (${id.policy}, ${id.account}, 7, 1, '{}'::jsonb, ${bytes("10", 32)}, ${bytes("11", 32)}, 'manual', 'active', ${marketId}, ${id.vault}, ${id.loanToken}, 900000000000000000, 1, ${blockHash}, ${databaseNow})`;
  await client`insert into account_snapshots
    (id, crest_account_id, owner_address, guardian_address, market_id, vault_deployment_id, max_collateral_assets, debt_ceiling_assets, max_strategy_assets, reserve_floor_assets, strategy_floor_assets, max_repay_per_action_assets, lower_ltv_wad, target_ltv_wad, upper_ltv_wad, critical_ltv_wad, borrowing_frozen, policy_nonce, loan_token_balance, block_number, block_hash, block_time, canonical, observed_at, provider_key)
    values (${id.snapshot}, ${id.account}, ${identity("0d", 20)}, ${Buffer.from(guardianAddress.slice(2), "hex")}, ${marketId}, ${id.vault}, 100, 100, 100, 10, 10, 50, 1, 2, 3, 4, false, 7, 100, 1, ${blockHash}, ${databaseNow}, true, ${databaseNow}, 'test')`;
  await client`insert into risk_assessments
    (id, crest_account_id, policy_id, account_snapshot_id, risk_engine_version, status, owner_borrow_capacity_assets, repay_capacity_assets, estimated_annual_carry_assets, estimated_spread_bps, recommended_action, canonical_input_hash, input_json, created_at)
    values (${id.assessment}, ${id.account}, ${id.policy}, ${id.snapshot}, 'guardian-test', 'PROTECT', 0, 50, null, null, ${actionKind === "freeze" ? "freeze" : actionKind}, ${bytes("12", 32)}, '{}'::jsonb, ${databaseNow})`;
  await client`insert into automation_triggers
    (id, idempotency_key, assessment_id, policy_id, action_kind, requested_assets, status, detected_at)
    values (${id.trigger}, ${identity("13", 32)}, ${id.assessment}, ${id.policy}, ${actionKind}, ${actionKind === "freeze" ? null : 25}, 'detected', ${databaseNow})`;

  return { account: id.account, accountAddress, guardianAddress, policy: id.policy, trigger: id.trigger, assessment: id.assessment };
}

function claim(input: Fixture) {
  return claimGuardianTrigger(db, { triggerId: input.trigger, chainId: 4663n, accountAddress: input.accountAddress, guardianAddress: input.guardianAddress, now });
}

function checks() {
  return ["frozen", "debt_decreased", "reserve_floor_held", "strategy_floor_held", "vault_receiver_fixed", "repay_beneficiary_fixed"].map((kind) => ({
    kind: kind as "frozen" | "debt_decreased" | "reserve_floor_held" | "strategy_floor_held" | "vault_receiver_fixed" | "repay_beneficiary_fixed",
    passed: true,
    expectedJson: { expected: kind },
    actualJson: { actual: kind },
  }));
}

const attemptHash = (input: Fixture) => `0x${input.account.replaceAll("-", "")}${"14".repeat(16)}` as `0x${string}`;

async function signedAttempt(
  runId: string,
  input: Fixture,
  transactionHash = attemptHash(input),
  selector: "freezeBorrowing()" | "repayFromReserve(uint256)" | "repayFromStrategy(uint256)" = "freezeBorrowing()",
) {
  return recordGuardianAttempt(db, {
    runId, chainId: 4663n, accountId: input.account, from: input.guardianAddress, to: input.accountAddress,
    selector, calldataHash: hash("15"), simulationBlockNumber: 1n, simulationBlockHash: hash("1a"), simulationGas: 100_000n,
    nonce: 2n, transactionHash,
  });
}

afterAll(async () => { await client.end(); });

describe("Guardian database repository", () => {
  test("concurrent claimers create one immutable run", async () => {
    const input = await fixture();
    const first = createDatabase(databaseUrl);
    const second = createDatabase(databaseUrl);
    const claims = await Promise.all([
      claimGuardianTrigger(first.db, { triggerId: input.trigger, chainId: 4663n, accountAddress: input.accountAddress, guardianAddress: input.guardianAddress, now }),
      claimGuardianTrigger(second.db, { triggerId: input.trigger, chainId: 4663n, accountAddress: input.accountAddress, guardianAddress: input.guardianAddress, now }),
    ]);
    await Promise.all([first.client.end(), second.client.end()]);
    const claimed = claims.filter((result): result is NonNullable<typeof result> => result !== null);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ triggerId: input.trigger, accountId: input.account, actionKind: "freeze", policyNonce: 7n, accountCodeHash: hash("0f") });
    expect(await client`select count(*)::int as count from automation_runs where trigger_id = ${input.trigger}`).toEqual([{ count: 1 }]);
  });

  test("serializes concurrent distinct trigger claims by guardian signer", async () => {
    const firstInput = await fixture();
    const secondInput = await fixture("freeze", firstInput.guardianAddress);
    const first = createDatabase(databaseUrl);
    const second = createDatabase(databaseUrl);
    const [firstClaim, secondClaim] = await Promise.all([
      claimGuardianTrigger(first.db, { triggerId: firstInput.trigger, chainId: 4663n, accountAddress: firstInput.accountAddress, guardianAddress: firstInput.guardianAddress, now }),
      claimGuardianTrigger(second.db, { triggerId: secondInput.trigger, chainId: 4663n, accountAddress: secondInput.accountAddress, guardianAddress: secondInput.guardianAddress, now }),
    ]);
    await Promise.all([first.client.end(), second.client.end()]);

    expect([firstClaim, secondClaim].filter((result): result is NonNullable<typeof result> => result !== null)).toHaveLength(1);
    const winner = firstClaim ? { claim: firstClaim, input: firstInput } : { claim: secondClaim!, input: secondInput };
    const loser = firstClaim ? secondInput : firstInput;
    expect(await client`select status from automation_triggers where id = ${loser.trigger}`).toEqual([{ status: "detected" }]);
    expect(await client`select count(*)::int as count from automation_runs where trigger_id = ${loser.trigger}`).toEqual([{ count: 0 }]);

    const attemptId = await signedAttempt(winner.claim.runId, winner.input);
    await markGuardianBroadcast(db, attemptId);
    await expect(claim(loser)).resolves.toBeNull();

    await recordGuardianReconciliation(db, {
      runId: winner.claim.runId,
      attemptId,
      receipt: { blockNumber: 2n, blockHash: hash("17"), canonical: true, success: true, gasUsed: 99_000n, decodedEvents: { crest: "Frozen" } },
      checks: checks(),
      checkedBlock: { number: 2n, hash: hash("17") },
      now,
    });
    await expect(claim(loser)).resolves.toMatchObject({ triggerId: loser.trigger });
    expect(await client`select status from automation_runs where id = ${winner.claim.runId}`).toEqual([{ status: "completed" }]);
    expect(await client`select status from automation_runs where trigger_id = ${loser.trigger}`).toEqual([{ status: "claimed" }]);
  });

  test("rejects a wrong account, reorged assessment snapshot, and stale policy", async () => {
    const wrongAccount = await fixture();
    await expect(claimGuardianTrigger(db, { triggerId: wrongAccount.trigger, chainId: 4663n, accountAddress: address("ff"), guardianAddress: wrongAccount.guardianAddress, now })).resolves.toBeNull();

    const reorged = await fixture();
    await client`update account_snapshots set canonical = false, reorged_at = ${databaseNow} where crest_account_id = ${reorged.account}`;
    await expect(claim(reorged)).resolves.toBeNull();

    const stale = await fixture();
    await client`update policies set status = 'reorged', invalidated_at = ${databaseNow} where id = ${stale.policy}`;
    await expect(claim(stale)).resolves.toBeNull();
  });

  test("a signed attempt is durable across restart and cannot be overwritten", async () => {
    const input = await fixture();
    const claimed = await claim(input);
    expect(claimed).not.toBeNull();
    const attemptId = await signedAttempt(claimed!.runId, input);
    await expect(recordGuardianAttempt(db, {
      runId: claimed!.runId, chainId: 4663n, accountId: input.account, from: input.guardianAddress, to: input.accountAddress,
      selector: "freezeBorrowing()", calldataHash: hash("15"), simulationBlockNumber: 1n, simulationBlockHash: hash("19"), simulationGas: 100_000n,
      nonce: 2n, transactionHash: attemptHash(input),
    })).rejects.toThrow("signed attempt evidence changed");
    const restarted = createDatabase(databaseUrl);
    const pending = await loadGuardianPendingAttempt(restarted.db, claimed!.runId);
    await restarted.client.end();

    expect(pending).toMatchObject({ attemptId, transactionHash: attemptHash(input), calldataHash: hash("15"), runId: claimed!.runId, simulationBlockNumber: 1n, simulationBlockHash: hash("1a"), accountAddress: input.accountAddress, guardianAddress: input.guardianAddress, policyNonce: 7n });
    await expect(closeGuardianClaim(db, { runId: claimed!.runId, status: "failed", reason: "simulation_failed", now })).rejects.toThrow("signed attempt exists");
  });
  test("refuses to persist a signed hash after the claimed assessment snapshot is reorged", async () => {
    const input = await fixture();
    const claimed = await claim(input);
    expect(claimed).not.toBeNull();
    await client`update account_snapshots set canonical = false, reorged_at = ${databaseNow}
      where crest_account_id = ${input.account}`;
    await expect(signedAttempt(claimed!.runId, input)).rejects.toThrow("guardian run cannot accept an attempt");
    expect(await client`select count(*)::int as count from transaction_attempts where run_id = ${claimed!.runId}`)
      .toEqual([{ count: 0 }]);
  });

  test("can close an unsigned claim exactly once without allowing a future reclaim", async () => {
    const input = await fixture();
    const claimed = await claim(input);
    expect(claimed).not.toBeNull();
    await closeGuardianClaim(db, { runId: claimed!.runId, status: "superseded", reason: "policy_changed", now });
    await expect(claim(input)).resolves.toBeNull();
    await expect(client`select status, failure_class from automation_runs where id = ${claimed!.runId}`).resolves.toEqual([{ status: "superseded", failure_class: "policy_changed" }]);
  });

  test("stores canonical receipt and postconditions atomically and idempotently", async () => {
    const input = await fixture("repay_strategy");
    const claimed = await claim(input);
    expect(claimed).not.toBeNull();
    const attemptId = await signedAttempt(claimed!.runId, input, undefined, "repayFromStrategy(uint256)");
    await markGuardianBroadcast(db, attemptId);
    const reconciliation = {
      runId: claimed!.runId,
      attemptId,
      receipt: { blockNumber: 2n, blockHash: hash("17"), canonical: true, success: true, gasUsed: 99_000n, decodedEvents: { crest: "RepaidFromStrategy" } },
      checks: checks(),
      checkedBlock: { number: 2n, hash: hash("17") },
      now,
    };
    await recordGuardianReconciliation(db, reconciliation);
    await recordGuardianReconciliation(db, reconciliation);
    expect(await client`select status, completed_at is not null as completed from automation_triggers where id = ${input.trigger}`).toEqual([{ status: "completed", completed: true }]);
    expect(await client`select status, finished_at is not null as finished from automation_runs where id = ${claimed!.runId}`).toEqual([{ status: "completed", finished: true }]);
    expect(await client`select count(*)::int as count from transaction_receipts where attempt_id = ${attemptId}`).toEqual([{ count: 1 }]);
    expect(await client`select count(*)::int as count from postcondition_checks where run_id = ${claimed!.runId}`).toEqual([{ count: 6 }]);
    await expect(loadGuardianPendingAttempt(db, claimed!.runId)).resolves.toBeNull();
  });

  test("reopens an orphaned receipt and records a re-mined signed transaction without overwriting evidence", async () => {
    const input = await fixture();
    const claimed = await claim(input);
    expect(claimed).not.toBeNull();
    const attemptId = await signedAttempt(claimed!.runId, input);
    await markGuardianBroadcast(db, attemptId);
    const original = {
      runId: claimed!.runId,
      attemptId,
      receipt: { blockNumber: 2n, blockHash: hash("17"), canonical: true, success: true, gasUsed: 99_000n, decodedEvents: { crest: "Frozen" } },
      checks: checks(),
      checkedBlock: { number: 2n, hash: hash("17") },
      now,
    };
    await recordGuardianReconciliation(db, original);
    await expect(loadGuardianRecordedReceipt(db, claimed!.runId)).resolves.toMatchObject({
      attemptId,
      transactionHash: attemptHash(input),
      blockNumber: 2n,
      blockHash: hash("17"),
      canonical: true,
    });

    await markGuardianReceiptReorged(db, claimed!.runId, attemptId, hash("17"), now);
    expect(await client`select canonical, reorged_at is not null as reorged from transaction_receipts where attempt_id = ${attemptId} and block_hash = ${bytes("17", 32)}`).toEqual([{ canonical: false, reorged: true }]);
    expect(await client`select status, finished_at is null as in_flight from automation_runs where id = ${claimed!.runId}`).toEqual([{ status: "broadcast", in_flight: true }]);
    expect(await client`select status, completed_at is null as in_flight from automation_triggers where id = ${input.trigger}`).toEqual([{ status: "claimed", in_flight: true }]);
    await expect(loadGuardianPendingAttempt(db, claimed!.runId)).resolves.toMatchObject({ attemptId, transactionHash: attemptHash(input) });
    expect(await client`select actual_json ->> 'actual' as actual from postcondition_checks where run_id = ${claimed!.runId} and kind = 'frozen' and checked_block_hash = ${bytes("17", 32)}`).toEqual([{ actual: "frozen" }]);

    const remined = {
      ...original,
      receipt: { ...original.receipt, blockNumber: 3n, blockHash: hash("18") },
      checks: checks().map((check) => ({ ...check, actualJson: { actual: `${check.kind}-remined` } })),
      checkedBlock: { number: 3n, hash: hash("18") },
    };
    await recordGuardianReconciliation(db, remined);
    await recordGuardianReconciliation(db, remined);
    await expect(loadGuardianRecordedReceipt(db, claimed!.runId)).resolves.toMatchObject({
      attemptId,
      transactionHash: attemptHash(input),
      blockNumber: 3n,
      blockHash: hash("18"),
      canonical: true,
    });
    expect(await client`select count(*)::int as count from transaction_receipts where attempt_id = ${attemptId}`).toEqual([{ count: 2 }]);
    expect(await client`select count(*)::int as count from postcondition_checks where run_id = ${claimed!.runId} and checked_block_hash = ${bytes("17", 32)}`).toEqual([{ count: 6 }]);
    expect(await client`select count(*)::int as count from postcondition_checks where run_id = ${claimed!.runId} and checked_block_hash = ${bytes("18", 32)}`).toEqual([{ count: 6 }]);
    expect(await client`select status from automation_runs where id = ${claimed!.runId}`).toEqual([{ status: "completed" }]);
    expect(await client`select status from automation_triggers where id = ${input.trigger}`).toEqual([{ status: "completed" }]);
    await expect(recordGuardianReconciliation(db, {
      ...remined,
      receipt: { ...remined.receipt, blockNumber: 4n, blockHash: hash("19") },
      checkedBlock: { number: 4n, hash: hash("19") },
    })).rejects.toThrow("canonical Guardian receipt exists");
  });
  test("marks an orphaned receipt noncanonical even when another run already owns the signer", async () => {
    const first = await fixture();
    const second = await fixture("freeze", first.guardianAddress);
    const firstClaim = await claim(first);
    expect(firstClaim).not.toBeNull();
    const attemptId = await signedAttempt(firstClaim!.runId, first);
    await markGuardianBroadcast(db, attemptId);
    await recordGuardianReconciliation(db, {
      runId: firstClaim!.runId, attemptId,
      receipt: { blockNumber: 2n, blockHash: hash("17"), canonical: true, success: true,
        gasUsed: 99_000n, decodedEvents: { crest: "Frozen" } },
      checks: checks(), checkedBlock: { number: 2n, hash: hash("17") }, now,
    });
    const secondClaim = await claim(second);
    expect(secondClaim).not.toBeNull();
    await expect(markGuardianReceiptReorged(db, firstClaim!.runId, attemptId, hash("17"), now)).resolves.toBe("conflict");
    expect(await client`select canonical from transaction_receipts where attempt_id = ${attemptId}`).toEqual([{ canonical: false }]);
    expect(await client`select status from automation_runs where id = ${firstClaim!.runId}`).toEqual([{ status: "reorg_conflict" }]);
    expect(await client`select status from automation_runs where id = ${secondClaim!.runId}`).toEqual([{ status: "claimed" }]);
    await expect(loadGuardianPendingAttempt(db, firstClaim!.runId)).resolves.toMatchObject({ transactionHash: attemptHash(first) });
    await closeGuardianClaim(db, { runId: secondClaim!.runId, status: "failed", reason: "unsigned_claim_closed", now });
    const third = await fixture("freeze", first.guardianAddress);
    await expect(claim(third)).resolves.toBeNull();
    expect(await client`select status from automation_triggers where id = ${third.trigger}`).toEqual([{ status: "detected" }]);
    await recordGuardianReconciliation(db, {
      runId: firstClaim!.runId, attemptId,
      receipt: { blockNumber: 3n, blockHash: hash("18"), canonical: true, success: true,
        gasUsed: 99_000n, decodedEvents: { crest: "Frozen" } },
      checks: checks(), checkedBlock: { number: 3n, hash: hash("18") }, now,
    });
    await expect(claim(third)).resolves.toMatchObject({ triggerId: third.trigger });
  });

});
