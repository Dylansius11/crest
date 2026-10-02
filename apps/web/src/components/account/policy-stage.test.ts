import { describe, expect, test } from "vitest";
import { assertStagedPolicyResponse } from "./policy-stage";

const expected = {
  chainId: 4663,
  owner: "0x1111111111111111111111111111111111111111",
  account: "0x2222222222222222222222222222222222222222",
  policyHash: `0x${"a".repeat(64)}`,
  contentHash: `0x${"b".repeat(64)}`,
  calldata: "0xdeadbeef1111",
  selector: "0xdeadbeef",
};
const staged = {
  evidence: "canonical-deployment",
  chainId: 4663,
  account: expected.account,
  policy: {
    status: "pending", policyNonce: "1", policyHash: expected.policyHash, contentHash: expected.contentHash,
    configurationCall: { chainId: 4663, from: expected.owner, to: expected.account, data: expected.calldata, selector: expected.selector, value: "0", functionName: "configure" },
  },
};

describe("owner policy pre-signature reconciliation", () => {
  test("accepts a staged next nonce only when its full calldata matches the owner's draft", () => {
    expect(assertStagedPolicyResponse(staged, expected)).toBe("1");
  });

  test("refuses stale active rows and mismatched server calldata instead of offering a signature", () => {
    expect(() => assertStagedPolicyResponse({ ...staged, policy: { ...staged.policy, status: "active" } }, expected)).toThrow();
    expect(() => assertStagedPolicyResponse({ ...staged, policy: { ...staged.policy, configurationCall: { ...staged.policy.configurationCall, data: "0xdeadbeef2222" } } }, expected)).toThrow();
    expect(() => assertStagedPolicyResponse({ ...staged, policy: { ...staged.policy, policyHash: `0x${"c".repeat(64)}` } }, expected)).toThrow();
  });

  test("refuses wrong chain, account or signing wallet even if the calldata is identical", () => {
    expect(() => assertStagedPolicyResponse({ ...staged, chainId: 1 }, expected)).toThrow();
    expect(() => assertStagedPolicyResponse({ ...staged, account: expected.owner }, expected)).toThrow();
    expect(() => assertStagedPolicyResponse({ ...staged, policy: { ...staged.policy, configurationCall: { ...staged.policy.configurationCall, from: expected.account } } }, expected)).toThrow();
  });
});
