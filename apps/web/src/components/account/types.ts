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
  } | null;
  assessment: {
    status: string;
    createdAt: string;
    reasonCodes: string[];
    ownerBorrowCapacityAssets: string | null;
    projectedCarryAssets: string | null;
    projectedSpreadBps: string | null;
  } | null;
  realizedDebtRepaidAssets: string | null;
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
