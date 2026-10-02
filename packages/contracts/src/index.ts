import generated from "../generated/crest-account.json" with { type: "json" };
import type { CrestAccountArtifact, Hex } from "./surface.ts";

export { GUARDIAN_SELECTORS, FORBIDDEN_SIGNATURE_PATTERNS } from "./surface.ts";
export type { AbiEntry, AbiInput, CrestAccountArtifact, Hex } from "./surface.ts";

/** Checked-in Crest Account surface; regenerate with `pnpm --filter @crest/contracts generate`. */
export const crestAccount: CrestAccountArtifact = generated as CrestAccountArtifact;
export const crestAccountAbi = crestAccount.abi;

/**
 * Exact creation bytecode of the compiled Crest Account, carried as data so the owner flow can call
 * `deployContract({ abi: crestAccountAbi, bytecode: crestAccountCreationBytecode, args: [owner, morpho] })`
 * in the browser, with no filesystem or Foundry output at runtime.
 */
export const crestAccountCreationBytecode: Hex = crestAccount.creationBytecode;

/** Addresses a deployed Crest Account is bound to; every one comes from the verified deployment manifest. */
export interface CrestDeployment {
  chainId: number;
  account: `0x${string}`;
  morpho: `0x${string}`;
  marketId: `0x${string}`;
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  yieldVault: `0x${string}`;
  guardian: `0x${string}`;
  owner: `0x${string}`;
  policyNonce: number;
}
