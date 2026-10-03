import { readFileSync } from "node:fs";
import { decodeDeployData, encodeDeployData } from "viem";
import type { Abi } from "viem";
import { describe, expect, test } from "vitest";

import {
  buildArtifact,
  FORBIDDEN_SIGNATURE_PATTERNS,
  generatedPath,
  GUARDIAN_SELECTORS,
  readFoundryArtifact,
  serializeArtifact,
} from "./artifact.ts";
import { crestAccountAbi, crestAccountCreationBytecode } from "./index.ts";

const compiled = buildArtifact();
const foundry = readFoundryArtifact();

/** Digits-only addresses, so a checksum round-trip cannot mask an encoding mistake. */
const owner = "0x1111111111111111111111111111111111111111";
const morpho = "0x2222222222222222222222222222222222222222";

describe("Crest Account ABI gate", () => {
  test("checked-in ABI matches the compiled contract", () => {
    const checkedIn = readFileSync(generatedPath, "utf8");
    expect(checkedIn, "run `pnpm --filter @crest/contracts generate` after changing the contract").toBe(
      serializeArtifact(compiled),
    );
  });

  test("Guardian can call exactly the three bounded debt-reducing entry points", () => {
    const guardianOnly = Object.keys(compiled.guardianSelectors);
    expect(guardianOnly).toStrictEqual([...GUARDIAN_SELECTORS]);
    for (const [signature, selector] of Object.entries(compiled.guardianSelectors)) {
      expect(selector).toBe(`0x${compiled.methodIdentifiers[signature]}`);
    }
  });

  test("no generic execution, upgrade or sweep entry point exists", () => {
    const offending = Object.keys(compiled.methodIdentifiers).filter((signature) =>
      FORBIDDEN_SIGNATURE_PATTERNS.some((pattern) => pattern.test(signature)),
    );
    expect(offending).toStrictEqual([]);
  });

  test("every borrow and value-moving entry point stays outside the Guardian surface", () => {
    const valueMoving = Object.keys(compiled.methodIdentifiers).filter((signature) =>
      /^(borrowAndDeploy|depositToStrategy|withdraw|supplyCollateral|configure|setGuardian|transferOwnership|unfreezeBorrowing)/.test(
        signature,
      ),
    );
    expect(valueMoving.length).toBeGreaterThan(0);
    for (const signature of valueMoving) expect(GUARDIAN_SELECTORS).not.toContain(signature);
  });
});

describe("Crest Account deployment artifact", () => {
  test("the exported create bytecode is the current Foundry creation bytecode", () => {
    expect(crestAccountCreationBytecode).toBe(compiled.creationBytecode);
    expect(crestAccountCreationBytecode).toBe(foundry.bytecode?.object);
  });

  test("the creation bytecode is deployable hex with no link placeholders", () => {
    expect(crestAccountCreationBytecode).toMatch(/^0x(?:[0-9a-f]{2})+$/);
    expect(crestAccountCreationBytecode.length).toBeGreaterThan(2);
    expect(crestAccountCreationBytecode.length % 2).toBe(0);
    expect(Object.keys(foundry.bytecode?.linkReferences ?? {})).toStrictEqual([]);
    expect(Object.keys(foundry.deployedBytecode?.linkReferences ?? {})).toStrictEqual([]);
  });

  test("the creation bytecode embeds the compiled Crest Account runtime", () => {
    const runtime = foundry.deployedBytecode?.object?.slice(2) ?? "";
    // Solidity appends the runtime code as the tail of the creation code, so this ties the checked-in
    // deployable blob to the compiled account rather than to any other contract of the same size.
    expect(runtime.length).toBeGreaterThan(1_000);
    expect(crestAccountCreationBytecode.endsWith(runtime)).toBe(true);
  });

  test("the owner flow can deploy it with (owner, morpho)", () => {
    const abi = crestAccountAbi as Abi;
    const constructors = abi.filter((entry) => entry.type === "constructor");
    expect(constructors).toHaveLength(1);
    expect(constructors[0]?.inputs?.map((input) => input.type)).toStrictEqual(["address", "address"]);

    const data = encodeDeployData({ abi, bytecode: crestAccountCreationBytecode, args: [owner, morpho] });
    expect(data.startsWith(crestAccountCreationBytecode)).toBe(true);
    expect(data.length).toBe(crestAccountCreationBytecode.length + 2 * 64);

    const decoded = decodeDeployData({ abi, bytecode: crestAccountCreationBytecode, data });
    expect(decoded.bytecode).toBe(crestAccountCreationBytecode);
    expect(decoded.args).toStrictEqual([owner, morpho]);
  });
});
