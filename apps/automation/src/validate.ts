export type GuardianActionKind = "freeze" | "repay_reserve" | "repay_strategy";

export interface GuardianState {
  block: { number: bigint; hash: `0x${string}`; timestamp: bigint };
  account: `0x${string}`;
  guardian: `0x${string}`;
  policyNonce: bigint;
  policyHash: `0x${string}`;
  marketId: `0x${string}`;
  vault: `0x${string}`;
  debtAssets: bigint | null;
  reserveAssets: bigint | null;
  shares: bigint | null;
  strategyAssets: bigint | null;
  withdrawableAssets: bigint | null;
  frozen: boolean;
  reserveFloorAssets: bigint;
  strategyFloorAssets: bigint;
  maxRepayPerActionAssets: bigint;
}

export interface GuardianActionClaim {
  actionKind: GuardianActionKind;
  requestedAssets: bigint | null;
  policyNonce: bigint;
}

export interface GuardianActionExpectation {
  account: `0x${string}`;
  guardian: `0x${string}`;
  policyHash: `0x${string}`;
  marketId: `0x${string}`;
  vault: `0x${string}`;
}

export type GuardianAction =
  | { kind: "freeze" }
  | { kind: "repay_reserve" | "repay_strategy"; assets: bigint };

export function validateGuardianAction(
  claim: GuardianActionClaim,
  state: GuardianState,
  expected: GuardianActionExpectation,
): GuardianAction {
  if (claim.policyNonce !== state.policyNonce) throw new Error("Guardian policy nonce changed");
  if (state.account.toLowerCase() !== expected.account.toLowerCase()) throw new Error("Guardian account changed");
  if (state.guardian.toLowerCase() !== expected.guardian.toLowerCase()) throw new Error("Guardian changed");
  if (state.policyHash.toLowerCase() !== expected.policyHash.toLowerCase()) throw new Error("Guardian policy hash changed");
  if (state.marketId.toLowerCase() !== expected.marketId.toLowerCase()) throw new Error("Guardian market changed");
  if (state.vault.toLowerCase() !== expected.vault.toLowerCase()) throw new Error("Guardian vault changed");

  switch (claim.actionKind) {
    case "freeze":
      if (state.frozen) throw new Error("Guardian account is already frozen");
      if (claim.requestedAssets !== null) throw new Error("Freeze cannot include assets");
      return { kind: "freeze" };

    case "repay_reserve": {
      if (state.debtAssets === null || state.debtAssets <= 0n) throw new Error("Guardian account has no debt to repay");
      if (state.reserveAssets === null) throw new Error("Guardian reserve liquidity unavailable");
      if (claim.requestedAssets === null || claim.requestedAssets <= 0n) throw new Error("Reserve repayment requires positive assets");
      const floorSafeReserve = state.reserveAssets > state.reserveFloorAssets ? state.reserveAssets - state.reserveFloorAssets : 0n;
      const assets = [claim.requestedAssets, state.maxRepayPerActionAssets, floorSafeReserve, state.debtAssets].reduce(
        (minimum, amount) => (amount < minimum ? amount : minimum),
      );
      if (assets <= 0n) throw new Error("Reserve repayment has no safe capacity");
      return { kind: "repay_reserve", assets };
    }

    case "repay_strategy": {
      if (state.debtAssets === null || state.debtAssets <= 0n) throw new Error("Guardian account has no debt to repay");
      if (state.strategyAssets === null || state.withdrawableAssets === null) throw new Error("Guardian strategy liquidity unavailable");
      if (claim.requestedAssets === null || claim.requestedAssets <= 0n) throw new Error("Strategy repayment requires positive assets");
      const floorSafeStrategy = state.strategyAssets > state.strategyFloorAssets ? state.strategyAssets - state.strategyFloorAssets : 0n;
      const assets = [claim.requestedAssets, state.maxRepayPerActionAssets, state.withdrawableAssets, floorSafeStrategy, state.debtAssets].reduce(
        (minimum, amount) => (amount < minimum ? amount : minimum),
      );
      if (assets <= 0n) throw new Error("Strategy repayment has no safe capacity");
      return { kind: "repay_strategy", assets };
    }

    default:
      throw new Error("Guardian action is not permitted");
  }
}
