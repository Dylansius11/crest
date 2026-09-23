import { createPublicClient, custom, decodeFunctionData, encodeFunctionResult, toHex } from "viem";
import type { Abi, Address, Hex, PublicClient } from "viem";

import { robinhoodChain } from "./client.ts";

/**
 * A deterministic JSON-RPC endpoint for adapter tests.
 *
 * It answers only what a test declares: chain id, one head block, bytecode, and exact contract calls matched by
 * address, selector, and arguments. Anything undeclared reverts, so a test cannot pass by reading a value it
 * never stated.
 */

export interface FakeCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  result?: unknown;
  /** Revert message instead of a result. */
  revert?: string;
}

export interface FakeChainOptions {
  chainId?: number;
  block: { number: bigint; hash: Hex; timestamp: bigint };
  code?: Record<Address, Hex>;
  calls?: FakeCall[];
}

export class RpcRevert extends Error {
  code = 3;
  data = "0x";
}

/** Addresses compare case-insensitively at any depth, so tuple arguments match regardless of checksum casing. */
function sameArgs(expected: readonly unknown[] | undefined, actual: readonly unknown[] | undefined): boolean {
  const normalize = (args: readonly unknown[] | undefined) =>
    JSON.stringify(args ?? [], (_key, inner: unknown) =>
      typeof inner === "bigint" ? `${inner}n` : typeof inner === "string" ? inner.toLowerCase() : inner);
  return normalize(expected) === normalize(actual);
}

export function fakeChain(options: FakeChainOptions): PublicClient {
  const { block } = options;
  const blockJson = {
    number: toHex(block.number),
    hash: block.hash,
    parentHash: `0x${"0".repeat(64)}`,
    timestamp: toHex(block.timestamp),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    gasLimit: "0x0",
    gasUsed: "0x0",
    miner: `0x${"0".repeat(40)}`,
    extraData: "0x",
    logsBloom: `0x${"0".repeat(512)}`,
    transactionsRoot: `0x${"0".repeat(64)}`,
    stateRoot: `0x${"0".repeat(64)}`,
    receiptsRoot: `0x${"0".repeat(64)}`,
    sha3Uncles: `0x${"0".repeat(64)}`,
    size: "0x0",
    totalDifficulty: "0x0",
    transactions: [],
    uncles: [],
    baseFeePerGas: "0x0",
  };

  const handle = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    const list = (params ?? []) as unknown[];
    if (method === "eth_chainId") return toHex(options.chainId ?? robinhoodChain.id);
    if (method === "eth_getBlockByNumber") return blockJson;
    if (method === "eth_getCode") {
      const address = String(list[0]).toLowerCase();
      const entry = Object.entries(options.code ?? {}).find(([key]) => key.toLowerCase() === address);
      return entry?.[1] ?? "0x";
    }
    if (method === "eth_call") {
      const request = list[0] as { to: Address; data: Hex };
      for (const call of options.calls ?? []) {
        if (call.address.toLowerCase() !== request.to.toLowerCase()) continue;
        let decoded: { functionName: string; args?: readonly unknown[] | undefined };
        try {
          decoded = decodeFunctionData({ abi: call.abi, data: request.data });
        } catch {
          continue;
        }
        if (decoded.functionName !== call.functionName || !sameArgs(call.args, decoded.args)) continue;
        if (call.revert !== undefined) throw new RpcRevert(`execution reverted: ${call.revert}`);
        return encodeFunctionResult({ abi: call.abi, functionName: call.functionName, result: call.result } as never);
      }
      throw new RpcRevert(`execution reverted: no fake call for ${request.to} ${request.data.slice(0, 10)}`);
    }
    throw new Error(`fakeChain does not serve ${method}`);
  };

  return createPublicClient({ chain: robinhoodChain, transport: custom({ request: handle }, { retryCount: 0 }) });
}
