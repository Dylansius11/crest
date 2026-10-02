import { describe, expect, test } from "vitest";

import { mainnetManifest, testnetManifest } from "./manifest";
import { isOwnerSigningEnabled } from "./transaction-route";

describe("owner signing gate", () => {
  test("enables the labeled testnet sandbox route", () => {
    expect(testnetManifest.trust.level).toBe("sandbox");
    expect(isOwnerSigningEnabled(testnetManifest)).toBe(true);
  });

  test("keeps the reviewed mainnet route signing-disabled until a canary is approved", () => {
    expect(isOwnerSigningEnabled(mainnetManifest)).toBe(false);
  });

  test("rejects a testnet route without a qualified market and vault", () => {
    expect(isOwnerSigningEnabled({ ...testnetManifest, gate: { ...testnetManifest.gate, outcome: "reserve_only" } })).toBe(false);
  });
});
