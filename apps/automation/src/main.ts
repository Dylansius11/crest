import { createPublicClient, http, parseAbi } from "viem";
import type { Address } from "viem";

import { crestAccountAbi } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";

import { verifyGuardianAuthority } from "./authority.ts";

/**
 * Crest Guardian operator CLI.
 *
 * `doctor` is the only command in MVP: it proves the deployment an operator is about to run a Guardian
 * against is the reviewed one, and that the Guardian surface is still exactly freeze plus own-debt repayment.
 * It deliberately never reads `GUARDIAN_PRIVATE_KEY`, never builds a transaction, and never signs.
 */

const ACCOUNT_ABI = parseAbi([
  "function owner() view returns (address)",
  "function guardian() view returns (address)",
  "function borrowingFrozen() view returns (bool)",
]);

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required; the Guardian CLI refuses to infer it`);
    process.exit(1);
  }
  return value;
}

const command = process.argv[2];
if (command !== "doctor") {
  console.error("usage: crest-guardian doctor");
  process.exit(1);
}

const rpcUrl = required("ROBINHOOD_CHAIN_RPC_URL");
const expectedGuardian = required("GUARDIAN_EXPECTED_ADDRESS");
const allowedAccount = required("GUARDIAN_ALLOWED_ACCOUNT");

const manifest = await loadDeploymentManifest();
const client = createPublicClient({ transport: http(rpcUrl) });
const account = allowedAccount as Address;
const [chainId, owner, guardian, borrowingFrozen] = await Promise.all([
  client.getChainId(),
  client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner" }),
  client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "guardian" }),
  client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "borrowingFrozen" }),
]);

const report = verifyGuardianAuthority(
  crestAccountAbi,
  { account, chainId, owner, guardian, borrowingFrozen },
  { expectedGuardian, allowedAccount },
  manifest.network.chainId,
);

console.log(JSON.stringify({ service: "crest-guardian", command: "doctor", ...report }, null, 2));
if (report.status === "failed") process.exit(1);
