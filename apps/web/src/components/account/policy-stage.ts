type StageExpectation = {
  chainId: number;
  owner: string;
  account: string;
  policyHash: string;
  contentHash: string;
  calldata: string;
  selector: string;
};

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Policy staging response is not an object");
  return value as Record<string, unknown>;
}

function equalHex(left: unknown, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

/** A server row is never signature authority unless it describes exactly the owner's compiled call. */
export function assertStagedPolicyResponse(value: unknown, expected: StageExpectation): string {
  const response = record(value);
  const policy = record(response.policy);
  const call = record(policy.configurationCall);
  if (response.evidence !== "canonical-deployment" || response.chainId !== expected.chainId
    || !equalHex(response.account, expected.account) || policy.status !== "pending"
    || typeof policy.policyNonce !== "string" || !/^[1-9]\d*$/.test(policy.policyNonce)
    || !equalHex(policy.policyHash, expected.policyHash) || !equalHex(policy.contentHash, expected.contentHash)
    || call.chainId !== expected.chainId || !equalHex(call.from, expected.owner) || !equalHex(call.to, expected.account)
    || !equalHex(call.data, expected.calldata) || !equalHex(call.selector, expected.selector)
    || call.value !== "0" || call.functionName !== "configure") {
    throw new Error("Stored policy does not match the exact owner-signed configuration; signature blocked");
  }
  return policy.policyNonce;
}
