import { describe, expect, test } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseTransaction, keccak256, type Hex } from "viem";
import { buildGuardianCall } from "./simulate.ts";
import { submitSignedGuardianCall } from "./submit.ts";

const guardian = privateKeyToAccount(generatePrivateKey());
const target = "0x1111111111111111111111111111111111111111" as const;
const call = buildGuardianCall({ kind: "repay_reserve", assets: 25n }, target);
const transaction = { chainId: 4663, nonce: 7, gas: 150_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n } as const;

describe("Custos signed submission", () => {
  test("persists the signed hash before any broadcast and sends only the fixed account calldata", async () => {
    const events: string[] = [];
    const result = await submitSignedGuardianCall({ signer: guardian, call, expectedAccount: target, transaction,
      persist: async (hash: Hex) => { events.push("persist"); expect(hash).toMatch(/^0x[0-9a-f]{64}$/); },
      broadcast: async (raw: Hex) => { events.push("broadcast"); const signed = parseTransaction(raw); expect(signed.to).toBe(target); expect(signed.data).toBe(call.data); expect(signed.value ?? 0n).toBe(0n); expect(signed.chainId).toBe(4663); return keccak256(raw); },
    });
    expect(events).toEqual(["persist", "broadcast"]);
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("a failed database write prevents broadcast; a broadcast error never resends", async () => {
    let sends = 0;
    await expect(submitSignedGuardianCall({ signer: guardian, call, expectedAccount: target, transaction,
      persist: async () => { throw new Error("database unavailable"); },
      broadcast: async () => { sends++; throw new Error("RPC unavailable"); },
    })).rejects.toThrow("database unavailable");
    expect(sends).toBe(0);
    await expect(submitSignedGuardianCall({ signer: guardian, call, expectedAccount: target, transaction,
      persist: async () => {},
      broadcast: async () => { sends++; throw new Error("RPC unavailable"); },
    })).rejects.toThrow("RPC unavailable");
    expect(sends).toBe(1);
  });
  test("cannot sign a fixed selector sent to a different account", async () => {
    await expect(submitSignedGuardianCall({
      signer: guardian, call: { ...call, to: "0x2222222222222222222222222222222222222222" },
      expectedAccount: target, transaction,
      persist: async () => { throw new Error("must not persist"); },
      broadcast: async () => { throw new Error("must not broadcast"); },
    })).rejects.toThrow("target account");
  });
});
