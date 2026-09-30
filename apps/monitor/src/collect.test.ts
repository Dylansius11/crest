import { describe, expect, test } from "vitest";
import type { PublicClient } from "viem";
import { pinConfirmedBlock } from "./collect.ts";

const hash = `0x${"a1".repeat(32)}` as const;
const client = (latest: bigint, visited: bigint[]): PublicClient => ({
  getChainId: async () => 4663,
  getBlock: async (args: { blockTag?: string; blockNumber?: bigint }) => {
    const number = args.blockTag === "latest" ? latest : args.blockNumber ?? 0n;
    visited.push(number);
    return { number, hash, timestamp: 1_700_000_000n };
  },
}) as unknown as PublicClient;

describe("monitor finalized horizon", () => {
  test("all downstream reads use a confirmed numbered block, never latest", async () => {
    const visited: bigint[] = [];
    const pinned = await pinConfirmedBlock(client(120n, visited), 20, 1_700_000_005n, 120n);
    expect(visited).toEqual([120n, 100n]);
    expect(pinned.value?.block).toEqual({ number: 100n, hash, timestamp: 1_700_000_000n });
    expect(pinned.status).toBe("normal");
  });

  test("insufficient confirmations fail closed instead of reading before account deployment", async () => {
    await expect(pinConfirmedBlock(client(10n, []), 20, 1_700_000_005n, 120n)).rejects.toThrow("confirmation depth");
  });
});
