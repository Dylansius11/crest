import { keccak256 } from "viem";
import type { Address, Hex } from "viem";

import type { DeploymentManifest } from "@crest/contracts/manifest";

/**
 * Route drift observation.
 *
 * The reviewed manifest describes identities that must never change: deployed bytecode of Morpho, the tokens,
 * the oracle, the IRM, and the vault, plus the vault's asset. This observer re-reads them at a named block and
 * reports every difference. It never reads rates, never projects carry, and never writes.
 */

export type CheckStatus = "matched" | "drifted" | "unreadable";

export interface RouteCheck {
  name: string;
  expected: string;
  actual: string | null;
  status: CheckStatus;
}

export interface RouteObservation {
  chainId: number;
  /** Block the reads were bound to, so a consumer can never treat this as timeless. */
  block: { number: string; hash: Hex; timestamp: string };
  manifestIntegrity: string;
  checks: RouteCheck[];
  status: "matched" | "drifted";
}

/** The reads this observer needs. Injected so drift behaviour is testable without a chain. */
export interface RouteReader {
  getChainId(): Promise<number>;
  getBlock(): Promise<{ number: bigint; hash: Hex; timestamp: bigint }>;
  getCode(address: Address, blockNumber: bigint): Promise<Hex | undefined>;
  readVaultAsset(vault: Address, blockNumber: bigint): Promise<Address>;
}

function compare(name: string, expected: string, actual: string | null): RouteCheck {
  if (actual === null) return { name, expected, actual, status: "unreadable" };
  const status: CheckStatus = actual.toLowerCase() === expected.toLowerCase() ? "matched" : "drifted";
  return { name, expected, actual, status };
}

export async function observeRoute(manifest: DeploymentManifest, reader: RouteReader): Promise<RouteObservation> {
  const chainId = await reader.getChainId();
  const block = await reader.getBlock();
  const checks: RouteCheck[] = [compare("network.chainId", String(manifest.network.chainId), String(chainId))];

  const contracts: [string, string, string][] = [
    ...Object.entries(manifest.contracts).map(([name, evidence]): [string, string, string] => [
      `contracts.${name}.codeHash`,
      evidence.codeHash,
      evidence.address,
    ]),
    ["vault.codeHash", manifest.vault.codeHash, manifest.vault.address],
  ];

  for (const [name, expected, address] of contracts) {
    const code = await reader.getCode(address as Address, block.number).catch(() => undefined);
    checks.push(compare(name, expected, code === undefined || code === "0x" ? null : keccak256(code)));
  }

  const asset = await reader.readVaultAsset(manifest.vault.address as Address, block.number).catch(() => null);
  checks.push(compare("vault.asset", manifest.vault.asset, asset));

  return {
    chainId,
    block: { number: block.number.toString(), hash: block.hash, timestamp: block.timestamp.toString() },
    manifestIntegrity: manifest.integrity.digest,
    checks,
    // Unreadable is not normal: a route that cannot be re-proven is reported as drifted so callers tighten.
    status: checks.every((check) => check.status === "matched") ? "matched" : "drifted",
  };
}
