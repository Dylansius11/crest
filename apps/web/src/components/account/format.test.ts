import { describe, expect, test } from "vitest";

import { percentPointsToWad } from "./format";

describe("policy LTV percentage input", () => {
  test("converts percentage points into the contract's 18-decimal WAD", () => {
    expect(percentPointsToWad("42.5")).toBe("425000000000000000");
    expect(percentPointsToWad("0.0000000000000001")).toBe("1");
  });

  test("rejects precision that cannot be represented as a WAD", () => {
    expect(() => percentPointsToWad("0.00000000000000001")).toThrow(/precision/i);
  });
});
