import { describe, expect, test } from "vitest";

import { MAX_HEAD_LAG_SECONDS, MAX_HEAD_LEAD_SECONDS, headLagError } from "./chain-head";

const nowMs = 1_790_932_392_000;
const now = BigInt(nowMs / 1000);

describe("owner simulation head freshness", () => {
  test("the lag budget is inclusive; one second past it refuses", () => {
    expect(headLagError(now - MAX_HEAD_LAG_SECONDS, nowMs)).toBeNull();
    expect(headLagError(now - MAX_HEAD_LAG_SECONDS - 1n, nowMs)).toContain("121 s old");
  });

  test("a head far ahead of this clock is untrusted, a small lead is tolerated", () => {
    expect(headLagError(now + MAX_HEAD_LEAD_SECONDS, nowMs)).toBeNull();
    expect(headLagError(now + MAX_HEAD_LEAD_SECONDS + 1n, nowMs)).toContain("ahead of this clock");
  });
});
