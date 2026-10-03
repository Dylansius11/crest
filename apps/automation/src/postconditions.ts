import type { GuardianAction, GuardianState } from "./validate.ts";

export type GuardianPostconditionKind =
  | "frozen"
  | "debt_decreased"
  | "reserve_floor_held"
  | "strategy_floor_held"
  | "vault_receiver_fixed"
  | "repay_beneficiary_fixed";

export interface GuardianPostconditionCheck {
  kind: GuardianPostconditionKind;
  passed: boolean;
  expectedJson: unknown;
  actualJson: unknown;
}

export interface GuardianReceiptEvidence {
  success: boolean;
  crestEvent?: {
    kind: GuardianAction["kind"];
    actor: `0x${string}`;
    debtBefore?: bigint;
    debtAfter?: bigint;
    assets?: bigint;
  };
  morphoRepay?: { beneficiary: `0x${string}`; assets: bigint };
  vaultWithdraw?: { owner: `0x${string}`; receiver: `0x${string}`; assets: bigint };
}

export interface GuardianPostconditionInput {
  action: GuardianAction;
  before: GuardianState;
  after: GuardianState;
  receipt: GuardianReceiptEvidence;
}

export function verifyGuardianPostconditions({ action, before, after, receipt }: GuardianPostconditionInput): GuardianPostconditionCheck[] {
  const crestEvent = receipt.crestEvent === undefined
    ? null
    : {
        kind: receipt.crestEvent.kind,
        actor: receipt.crestEvent.actor,
        debtBefore: receipt.crestEvent.debtBefore?.toString() ?? null,
        debtAfter: receipt.crestEvent.debtAfter?.toString() ?? null,
        assets: receipt.crestEvent.assets?.toString() ?? null,
      };
  const postStateExpectation = {
    account: before.account,
    guardian: before.guardian,
    policyNonce: before.policyNonce.toString(),
    policyHash: before.policyHash,
    marketId: before.marketId,
    vault: before.vault,
  };
  const postState = {
    account: after.account,
    guardian: after.guardian,
    policyNonce: after.policyNonce.toString(),
    policyHash: after.policyHash,
    marketId: after.marketId,
    vault: after.vault,
  };
  const postStateMatches = after.account.toLowerCase() === before.account.toLowerCase()
    && after.guardian.toLowerCase() === before.guardian.toLowerCase()
    && after.policyNonce === before.policyNonce
    && after.policyHash.toLowerCase() === before.policyHash.toLowerCase()
    && after.marketId.toLowerCase() === before.marketId.toLowerCase()
    && after.vault.toLowerCase() === before.vault.toLowerCase();
  const receiptExpectation = { success: true, crestEvent: { kind: action.kind, actor: before.guardian }, postState: postStateExpectation };
  const receiptMatches = receipt.success
    && receipt.crestEvent?.kind === action.kind
    && receipt.crestEvent.actor.toLowerCase() === before.guardian.toLowerCase();

  if (action.kind === "freeze") {
    return [{
      kind: "frozen",
      passed: receiptMatches && postStateMatches && after.frozen,
      expectedJson: { ...receiptExpectation, frozen: true },
      actualJson: { success: receipt.success, crestEvent, postState, frozen: after.frozen },
    }];
  }

  if (before.debtAssets === null || after.debtAssets === null) {
    throw new Error("Guardian debt evidence unavailable for repayment");
  }

  const debtEventMatches = receiptMatches
    && receipt.crestEvent?.debtBefore !== undefined
    && receipt.crestEvent.debtAfter !== undefined
    && receipt.crestEvent.debtBefore > receipt.crestEvent.debtAfter
    && receipt.crestEvent.assets !== undefined
    && receipt.crestEvent.assets > 0n;
  const debtActual = {
    success: receipt.success,
    crestEvent,
    postState,
    debtBefore: before.debtAssets.toString(),
    debtAfter: after.debtAssets.toString(),
  };
  const debtCheck: GuardianPostconditionCheck = {
    kind: "debt_decreased",
    passed: debtEventMatches && postStateMatches && after.debtAssets < before.debtAssets,
    expectedJson: { ...receiptExpectation, debtAfter: `<${before.debtAssets}` },
    actualJson: debtActual,
  };
  const beneficiaryCheck: GuardianPostconditionCheck = {
    kind: "repay_beneficiary_fixed",
    passed: receiptMatches
      && postStateMatches
      && receipt.morphoRepay !== undefined
      && receipt.morphoRepay.beneficiary.toLowerCase() === before.account.toLowerCase()
      && receipt.morphoRepay.assets > 0n,
    expectedJson: { ...receiptExpectation, beneficiary: before.account, assets: ">0" },
    actualJson: receipt.morphoRepay === undefined
      ? { success: receipt.success, crestEvent, postState, morphoRepay: null }
      : { success: receipt.success, crestEvent, postState, beneficiary: receipt.morphoRepay.beneficiary, assets: receipt.morphoRepay.assets.toString() },
  };

  if (action.kind === "repay_reserve") {
    return [
      debtCheck,
      {
        kind: "reserve_floor_held",
        passed: receiptMatches && postStateMatches && after.reserveAssets !== null && after.reserveAssets >= after.reserveFloorAssets,
        expectedJson: { ...receiptExpectation, reserveAssets: `>=${after.reserveFloorAssets}` },
        actualJson: {
          success: receipt.success,
          crestEvent,
          postState,
          reserveAssets: after.reserveAssets?.toString() ?? null,
          reserveFloorAssets: after.reserveFloorAssets.toString(),
        },
      },
      beneficiaryCheck,
    ];
  }

  return [
    debtCheck,
    {
      kind: "strategy_floor_held",
      passed: receiptMatches && postStateMatches && after.strategyAssets !== null && after.strategyAssets >= after.strategyFloorAssets,
      expectedJson: { ...receiptExpectation, strategyAssets: `>=${after.strategyFloorAssets}` },
      actualJson: {
        success: receipt.success,
        crestEvent,
        postState,
        strategyAssets: after.strategyAssets?.toString() ?? null,
        strategyFloorAssets: after.strategyFloorAssets.toString(),
      },
    },
    {
      kind: "vault_receiver_fixed",
      passed: receiptMatches
        && postStateMatches
        && receipt.vaultWithdraw !== undefined
        && receipt.vaultWithdraw.owner.toLowerCase() === before.account.toLowerCase()
        && receipt.vaultWithdraw.receiver.toLowerCase() === before.account.toLowerCase()
        && receipt.vaultWithdraw.assets > 0n,
      expectedJson: { ...receiptExpectation, owner: before.account, receiver: before.account, assets: ">0" },
      actualJson: receipt.vaultWithdraw === undefined
        ? { success: receipt.success, crestEvent, postState, vaultWithdraw: null }
        : {
            success: receipt.success,
            crestEvent,
            postState,
            owner: receipt.vaultWithdraw.owner,
            receiver: receipt.vaultWithdraw.receiver,
            assets: receipt.vaultWithdraw.assets.toString(),
          },
    },
    beneficiaryCheck,
  ];
}
