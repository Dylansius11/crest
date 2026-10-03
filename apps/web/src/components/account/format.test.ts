import { describe, expect, test } from "vitest";

import { decimal, percentPointsToWad } from "./format";

describe("policy LTV percentage input", () => {
  test("converts percentage points into the contract's 18-decimal WAD", () => {
    expect(percentPointsToWad("42.5")).toBe("425000000000000000");
    expect(percentPointsToWad("0.0000000000000001")).toBe("1");
  });

  test("rejects precision that cannot be represented as a WAD", () => {
    expect(() => percentPointsToWad("0.00000000000000001")).toThrow(/precision/i);
  });
});

describe("token amount display", () => {
  test("a negative projection keeps one sign in front, including below one whole unit", () => {
    expect(decimal("-120000", 6, "USDG")).toBe("-0.12 USDG");
    expect(decimal("-2500000", 6, "USDG")).toBe("-2.5 USDG");
    expect(decimal("6675007", 6, "USDG")).toBe("6.675 USDG");
  });
});
