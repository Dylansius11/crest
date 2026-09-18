import generated from "../generated/crest-account.json" with { type: "json" };
import type { CrestAccountArtifact } from "./artifact.ts";

export { GUARDIAN_SELECTORS, FORBIDDEN_SIGNATURE_PATTERNS } from "./artifact.ts";
export type { AbiEntry, AbiInput, CrestAccountArtifact } from "./artifact.ts";

/** Checked-in Crest Account surface; regenerate with `pnpm --filter @crest/contracts generate`. */
export const crestAccount: CrestAccountArtifact = generated as CrestAccountArtifact;
export const crestAccountAbi = crestAccount.abi;

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
