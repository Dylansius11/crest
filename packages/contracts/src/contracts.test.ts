import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildArtifact, FORBIDDEN_SIGNATURE_PATTERNS, generatedPath, GUARDIAN_SELECTORS, serializeArtifact } from "./artifact.ts";

const compiled = buildArtifact();

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
