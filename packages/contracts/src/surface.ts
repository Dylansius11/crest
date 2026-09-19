/**
 * The pure Crest Account surface: the reviewed Guardian entry points, the shapes that describe an ABI,
 * and the forbidden patterns. No filesystem access, so every runtime - including the browser build - can
 * import it.
 */

/** Selectors the Guardian may call; every other state-changing entry point is owner-only. */
export const GUARDIAN_SELECTORS = ["freezeBorrowing()", "repayFromReserve(uint256)", "repayFromStrategy(uint256)"] as const;

/** Entry points that must never exist, because they would let a delegate move value or debt freely. */
export const FORBIDDEN_SIGNATURE_PATTERNS = [/^execute/i, /^multicall/i, /^call\(/i, /delegatecall/i, /^upgrade/i, /^sweep/i] as const;

export interface AbiInput {
  name: string;
  type: string;
  internalType?: string;
  components?: AbiInput[];
}

export interface AbiEntry {
  type: string;
  name?: string;
  inputs?: AbiInput[];
  outputs?: AbiInput[];
  stateMutability?: string;
  anonymous?: boolean;
}

export interface CrestAccountArtifact {
  contract: string;
  abi: AbiEntry[];
  methodIdentifiers: Record<string, string>;
  guardianSelectors: Record<string, string>;
}
