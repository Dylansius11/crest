import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = process.env.CREST_FOUNDRY_ARTIFACT ?? resolve(packageRoot, "../../contracts/out/CrestAccount.sol/CrestAccount.json");

/** Reads the Foundry build output and reduces it to the deterministic surface the workspace consumes. */
export function buildArtifact(): CrestAccountArtifact {
  let raw: string;
  try {
    raw = readFileSync(artifactPath, "utf8");
  } catch {
    throw new Error(`missing Foundry artifact at ${artifactPath}; run \`forge build\` in contracts/ first`);
  }
  const compiled = JSON.parse(raw) as { abi?: AbiEntry[]; methodIdentifiers?: Record<string, string> };
  const abi = compiled.abi;
  const methodIdentifiers = compiled.methodIdentifiers;
  if (!Array.isArray(abi) || !methodIdentifiers) throw new Error(`Foundry artifact at ${artifactPath} has no ABI`);

  const guardianSelectors = Object.fromEntries(
    GUARDIAN_SELECTORS.map((signature) => {
      const selector = methodIdentifiers[signature];
      if (!selector) throw new Error(`Guardian entry point ${signature} is missing from the contract ABI`);
      return [signature, `0x${selector}`];
    }),
  );

  return {
    contract: "CrestAccount",
    abi: [...abi].sort((left, right) => `${left.type}:${left.name ?? ""}`.localeCompare(`${right.type}:${right.name ?? ""}`)),
    methodIdentifiers: Object.fromEntries(Object.entries(methodIdentifiers).sort(([left], [right]) => left.localeCompare(right))),
    guardianSelectors,
  };
}

export function serializeArtifact(artifact: CrestAccountArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export const generatedPath = resolve(packageRoot, "generated/crest-account.json");
