import { GUARDIAN_SELECTORS } from "@crest/contracts";
import type { AbiEntry } from "@crest/contracts";
import type { DeploymentManifest } from "@crest/contracts/manifest";

/**
 * Guardian authority verification.
 *
 * Crest Guardian may only freeze borrowing and reduce this account's own debt. That is enforced onchain;
 * this module proves the deployment an operator is about to point a Guardian at actually matches, before any
 * key is loaded. Nothing here signs, builds a transaction, or reads a private key.
 */

export interface GuardianExpectation {
  /** Address the operator believes the Guardian key controls. */
  expectedGuardian: string;
  /** The single Crest Account this Guardian is allowed to touch. */
  allowedAccount: string;
}

export interface OnchainAccountState {
  account: string;
  chainId: number;
  owner: string;
  guardian: string;
  borrowingFrozen: boolean;
}

export type FindingStatus = "ok" | "failed";

export interface Finding {
  name: string;
  status: FindingStatus;
  detail: string;
}

export interface AuthorityReport {
  account: string;
  chainId: number;
  borrowingFrozen: boolean;
  findings: Finding[];
  status: FindingStatus;
}

function check(name: string, ok: boolean, detail: string): Finding {
  return { name, status: ok ? "ok" : "failed", detail };
}

/** Runtime signing is a testnet SANDBOX capability, not a property of a full-route manifest alone. */
export function guardianRuntimeSigningAllowed(manifest: Pick<DeploymentManifest, "network" | "trust">): boolean {
  return manifest.network.chainId === 46630 && manifest.trust.level === "sandbox";
}

/** Signatures the Guardian is allowed to call, derived from the compiled ABI rather than a written list. */
export function guardianSurface(abi: readonly AbiEntry[]): string[] {
  return abi
    .filter((entry) => entry.type === "function" && entry.stateMutability !== "view" && entry.stateMutability !== "pure")
    .map((entry) => `${entry.name ?? ""}(${(entry.inputs ?? []).map((input) => input.type).join(",")})`)
    .filter((signature) => (GUARDIAN_SELECTORS as readonly string[]).includes(signature))
    .sort();
}

export function verifyGuardianAuthority(
  abi: readonly AbiEntry[],
  state: OnchainAccountState,
  expectation: GuardianExpectation,
  chainId: number,
  proof: { accountCodeHashMatches: boolean; routeQualified: boolean; runtimeSigningAllowed: boolean },
): AuthorityReport {
  const surface = guardianSurface(abi);
  const expectedSurface = [...GUARDIAN_SELECTORS].sort();
  const findings: Finding[] = [
    check(
      "account matches the allowed account",
      state.account.toLowerCase() === expectation.allowedAccount.toLowerCase(),
      `${state.account} vs allowed ${expectation.allowedAccount}`,
    ),
    check("chain matches the reviewed route", state.chainId === chainId, `${state.chainId} vs manifest ${chainId}`),
    check(
      "onchain guardian is the expected signer",
      state.guardian.toLowerCase() === expectation.expectedGuardian.toLowerCase(),
      `${state.guardian} vs expected ${expectation.expectedGuardian}`,
    ),
    check(
      "guardian is not the owner",
      state.guardian.toLowerCase() !== state.owner.toLowerCase(),
      `owner ${state.owner}`,
    ),
    check("deployed account bytecode matches registered code hash", proof.accountCodeHashMatches, proof.accountCodeHashMatches ? "registered bytecode" : "account code mismatch"),
    check("manifest and onchain route are qualified", proof.routeQualified, proof.routeQualified ? "qualified route" : "route mismatch"),
    check("runtime signing allowed", proof.runtimeSigningAllowed, proof.runtimeSigningAllowed ? "sandbox signing enabled" : "runtime signing is disabled"),
    check(
      "compiled ABI exposes exactly the three Guardian methods",
      surface.length === expectedSurface.length && surface.every((signature, index) => signature === expectedSurface[index]),
      surface.join(", "),
    ),
  ];

  return {
    account: state.account,
    chainId: state.chainId,
    borrowingFrozen: state.borrowingFrozen,
    findings,
    status: findings.every((finding) => finding.status === "ok") ? "ok" : "failed",
  };
}
