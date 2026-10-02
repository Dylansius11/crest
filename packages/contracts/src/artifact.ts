import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GUARDIAN_SELECTORS } from "./surface.ts";
import type { AbiEntry, CrestAccountArtifact, Hex } from "./surface.ts";

export { FORBIDDEN_SIGNATURE_PATTERNS, GUARDIAN_SELECTORS } from "./surface.ts";
export type { AbiEntry, AbiInput, CrestAccountArtifact, Hex } from "./surface.ts";

/** Reads the Foundry build output; used only by the generator, never by an application runtime. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = process.env.CREST_FOUNDRY_ARTIFACT ?? resolve(packageRoot, "../../contracts/out/CrestAccount.sol/CrestAccount.json");

/** The only constructor the owner flow can deploy: `CrestAccount(address initialOwner, address morpho_)`. */
const CONSTRUCTOR_INPUT_TYPES = ["address", "address"] as const;

/** Nonempty, even-length, `0x`-prefixed hex; link placeholders (`__$…$__`) can never match. */
const CREATION_BYTECODE_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

/** The subset of the Foundry artifact this package consumes; the rest of the build output is not exported. */
export interface FoundryArtifact {
  abi?: AbiEntry[];
  bytecode?: { object?: string; linkReferences?: Record<string, unknown> };
  deployedBytecode?: { object?: string; linkReferences?: Record<string, unknown> };
  methodIdentifiers?: Record<string, string>;
}

/** Parses the Foundry build output; exported so the artifact test reads the same bytes the generator does. */
export function readFoundryArtifact(): FoundryArtifact {
  let raw: string;
  try {
    raw = readFileSync(artifactPath, "utf8");
  } catch {
    throw new Error(`missing Foundry artifact at ${artifactPath}; run \`forge build\` in contracts/ first`);
  }
  return JSON.parse(raw) as FoundryArtifact;
}

/**
 * Reduces the Foundry output to the deployable creation bytecode. An empty blob or an unresolved library
 * link would produce a `deployContract` call that can never succeed, so both are rejected here.
 */
function readCreationBytecode(compiled: FoundryArtifact): Hex {
  const object = compiled.bytecode?.object;
  if (typeof object !== "string" || !CREATION_BYTECODE_PATTERN.test(object)) {
    throw new Error(`Foundry artifact at ${artifactPath} has no valid CrestAccount creation bytecode`);
  }
  const unlinked = Object.keys({ ...compiled.bytecode?.linkReferences, ...compiled.deployedBytecode?.linkReferences });
  if (unlinked.length > 0) {
    throw new Error(`CrestAccount creation bytecode has unresolved library links (${unlinked.join(", ")}); link them before generating`);
  }
  return object as Hex;
}

/** Types of the constructor arguments, in order; Solidity omits the entry entirely for a zero-argument one. */
function readConstructorInputTypes(abi: AbiEntry[]): string[] {
  const constructors = abi.filter((entry) => entry.type === "constructor");
  if (constructors.length > 1) throw new Error("CrestAccount ABI declares more than one constructor");
  return (constructors[0]?.inputs ?? []).map((input) => input.type);
}

/** Reads the Foundry build output and reduces it to the deterministic surface the workspace consumes. */
export function buildArtifact(): CrestAccountArtifact {
  const compiled = readFoundryArtifact();
  const abi = compiled.abi;
  const methodIdentifiers = compiled.methodIdentifiers;
  if (!Array.isArray(abi) || !methodIdentifiers) throw new Error(`Foundry artifact at ${artifactPath} has no ABI`);

  const constructorInputs = readConstructorInputTypes(abi);
  if (
    constructorInputs.length !== CONSTRUCTOR_INPUT_TYPES.length ||
    constructorInputs.some((type, index) => type !== CONSTRUCTOR_INPUT_TYPES[index])
  ) {
    throw new Error(
      `CrestAccount constructor must take (${CONSTRUCTOR_INPUT_TYPES.join(", ")}) so the owner flow can deploy it with (owner, morpho); found (${constructorInputs.join(", ") || "no arguments"})`,
    );
  }

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
    creationBytecode: readCreationBytecode(compiled),
  };
}

export function serializeArtifact(artifact: CrestAccountArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export const generatedPath = resolve(packageRoot, "generated/crest-account.json");
