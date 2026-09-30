import { keccak256, toFunctionSelector, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { GUARDIAN_SELECTORS } from "@crest/contracts";
import type { buildGuardianCall } from "./simulate.ts";

type GuardianCall = ReturnType<typeof buildGuardianCall>;
type PreparedFees = {
  chainId: number;
  nonce: number;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

/** A durable transaction hash exists before a byte can reach the RPC. An uncertain send is never repeated here. */
export async function submitSignedGuardianCall(input: {
  signer: PrivateKeyAccount;
  call: GuardianCall;
  expectedAccount: Address;
  transaction: PreparedFees;
  persist: (hash: Hex) => Promise<void>;
  broadcast: (signed: Hex) => Promise<Hex>;
}): Promise<{ hash: Hex }> {
  if (input.transaction.chainId !== 4663) throw new Error("Guardian transaction must target Robinhood Chain");
  if (input.call.to.toLowerCase() !== input.expectedAccount.toLowerCase()) throw new Error("Guardian target account is not allowlisted");
  const allowed = GUARDIAN_SELECTORS.some((signature) => toFunctionSelector(signature) === input.call.data.slice(0, 10));
  if (!allowed) throw new Error("Guardian calldata selector is not permitted");
  const raw = await input.signer.signTransaction({
    ...input.transaction,
    type: "eip1559",
    to: input.call.to,
    data: input.call.data,
    value: 0n,
  });
  const hash = keccak256(raw);
  await input.persist(hash);
  const broadcastHash = await input.broadcast(raw);
  if (broadcastHash.toLowerCase() !== hash.toLowerCase()) throw new Error("RPC returned a different signed transaction hash");
  return { hash };
}
