import type { Address, Hex } from "viem";

export type RecordedAccount = {
  address: string;
  chainId: string;
  codeHash: string;
  policyNonce: string;
  status: string;
};

export type RecordedPosition = {
  evidence: "recorded";
  account: RecordedAccount;
  snapshot: {
    blockNumber: string;
    blockHash: string;
    observedAt: string;
    owner: string;
    guardian: string;
    frozen: boolean;
    collateralAssets: string | null;
    debtAssets: string | null;
    collateralValueAssets: string | null;
    ltvWad: string | null;
    morphoHealthWad: string | null;
    lowerLtvWad: string;
    targetLtvWad: string;
    upperLtvWad: string;
    criticalLtvWad: string;
    reserveAssets: string | null;
    vaultShares: string | null;
    quotedVaultAssets: string | null;
    withdrawableVaultAssets: string | null;
    reserveFloorAssets: string;
    strategyFloorAssets: string;
    maxRepayPerActionAssets: string;
  } | null;
  assessment: {
    status: string;
    createdAt: string;
    reasonCodes: string[];
    recommendedAction: string;
    policyHealthWad: string | null;
    ownerBorrowCapacityAssets: string | null;
    repayCapacityAssets: string | null;
    projectedCarryAssets: string | null;
    projectedSpreadBps: string | null;
    rates: { borrow: RecordedRate; vault: RecordedRate };
    provenance: RecordedInput[];
  } | null;
  realizedDebtRepaidAssets: string | null;
  latestRepayment: RecordedRepayment | null;
  latestIntervention: RecordedIntervention | null;
};

/** One rate exactly as the assessment consumed it; an unread rate keeps its status and reasons. */
export type RecordedRate = {
  status: string;
  reasons: string[];
  value: string | null;
  scale: string | null;
  convention: string | null;
  window: string | null;
  source: string | null;
  observedAt: string | null;
};

export type RecordedInput = {
  input: string;
  status: string;
  reasons: string[];
  source: string | null;
  blockNumber: string | null;
  observedAt: string | null;
};

export type RecordedRepayment = {
  debtBeforeAssets: string;
  debtAfterAssets: string;
  debtRepaidAssets: string;
  blockNumber: string;
  transactionHash: string;
};

export type RecordedIntervention = {
  actionKind: string;
  requestedAssets: string | null;
  status: string;
  reasonCodes: string[];
  detectedAt: string;
  forCurrentAssessment: boolean;
  run: {
    status: string;
    failureClass: string | null;
    transactionHash: string | null;
    checks: { kind: string; passed: boolean }[];
  } | null;
};

export type RecordedRegistry = { evidence: "recorded"; accounts: RecordedAccount[] };

export type WalletState =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "wrong-chain"; address: Address; chainId: number }
  | { kind: "connected"; address: Address };

export type TransactionPhase =
  | "idle"
  | "blocked"
  | "simulating"
  | "simulation-failed"
  | "signature-ready"
  | "pending"
  | "confirmed"
  | "reverted"
  | "reconciliation-failed";

/** Owner actions that leave the account: each moves value back to the connected owner wallet or reduces debt. */
export type ExitAction = "owner-repay" | "withdraw-strategy" | "withdraw-collateral" | "withdraw-reserve" | "unfreeze";

export type TransactionAction = "approve-collateral" | "approve-loan" | "configure" | "supply" | "borrow-and-deploy" | ExitAction;

/** Account state read directly from the chain at one block; never a recorded snapshot. */
export type LiveAccountState = {
  blockNumber: bigint;
  frozen: boolean | null;
  debtAssets: bigint | null;
  collateralAssets: bigint | null;
  reserveAssets: bigint | null;
  strategyAssets: bigint | null;
  withdrawableStrategyAssets: bigint | null;
  /** The policy the account enforces at this block; null when the read failed, never a default. */
  policy: LivePolicy | null;
};

export type LivePolicy = {
  nonce: bigint;
  maxCollateralAssets: bigint;
  debtCeilingAssets: bigint;
  maxStrategyAssets: bigint;
  reserveFloorAssets: bigint;
  strategyFloorAssets: bigint;
  maxRepayPerActionAssets: bigint;
  lowerLtvWad: bigint;
  targetLtvWad: bigint;
  upperLtvWad: bigint;
  criticalLtvWad: bigint;
  /** Morpho's liquidation LTV for the one market; set by Morpho, not by the owner. */
  lltvWad: bigint;
  guardian: Address;
};

export type TransactionEvidence = {
  phase: TransactionPhase;
  action: TransactionAction | null;
  detail: string;
  recipient?: Address;
  calldata?: Hex;
  selector?: Hex;
  gas?: bigint;
  blockNumber?: bigint;
  blockHash?: Hex;
  hash?: Hex;
};
