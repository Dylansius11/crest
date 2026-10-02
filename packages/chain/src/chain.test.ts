import { encodeFunctionData, getAddress, keccak256, parseAbi } from "viem";
import type { PublicClient } from "viem";
import { describe, expect, test } from "vitest";

import { CREST_ACCOUNT_ABI, FEED_ABI, pinBlock, readCodeHash, readCrestAccount, readFeed, simulateCall } from "./index.ts";
import { fakeChain } from "./testing.ts";

const block = { number: 70_212_238n, hash: `0x${"ab".repeat(32)}`, timestamp: 1_790_136_079n } as const;
const feed = "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0";
// Live Robinhood AAPL / USD round read at block 70212238 (answer 8 decimals).
const liveRound = [18_446_744_073_709_552_274n, 33_974_221_248n, 1_790_106_920n, 1_790_106_932n, 18_446_744_073_709_552_274n] as const;
const HEARTBEAT = 86_400n;

const account = "0x00000000000000000000000000000000000000a1";
const loanToken = "0x00000000000000000000000000000000000000b2";
const vault = "0x00000000000000000000000000000000000000c3";
const owner = "0x00000000000000000000000000000000000000d4";
const guardian = "0x00000000000000000000000000000000000000e5";
const marketId = `0x${"01".repeat(32)}`;
const policy = {
  market: {
    loanToken,
    collateralToken: "0x00000000000000000000000000000000000000f6",
    oracle: "0x00000000000000000000000000000000000000a7",
    irm: "0x00000000000000000000000000000000000000b8",
    lltv: 860_000_000_000_000_000n,
  },
  yieldVault: vault,
  maxCollateralAssets: 1_000n,
  debtCeilingAssets: 900n,
  maxStrategyAssets: 800n,
  reserveFloorAssets: 70n,
  strategyFloorAssets: 60n,
  maxRepayPerActionAssets: 50n,
  lowerLtvWad: 100_000_000_000_000_000n,
  targetLtvWad: 200_000_000_000_000_000n,
  upperLtvWad: 300_000_000_000_000_000n,
  criticalLtvWad: 400_000_000_000_000_000n,
  guardian,
} as const;

function withAccountState(options: { frozen?: boolean; nonce?: bigint } = {}): PublicClient {
  return fakeChain({
    block,
    calls: [
      { address: account, abi: CREST_ACCOUNT_ABI, functionName: "policy", result: policy },
      { address: account, abi: CREST_ACCOUNT_ABI, functionName: "policyNonce", result: options.nonce ?? 12n },
      { address: account, abi: CREST_ACCOUNT_ABI, functionName: "borrowingFrozen", result: options.frozen ?? false },
      { address: account, abi: CREST_ACCOUNT_ABI, functionName: "owner", result: owner },
      { address: account, abi: CREST_ACCOUNT_ABI, functionName: "guardian", result: guardian },
      { address: account, abi: CREST_ACCOUNT_ABI, functionName: "marketId", result: marketId },
      { address: loanToken, abi: CREST_ACCOUNT_ABI, functionName: "balanceOf", args: [account], result: 42n },
    ],
  });
}

describe("pinBlock", () => {
  test("refuses any chain other than Robinhood Chain", async () => {
    await expect(pinBlock(fakeChain({ chainId: 1, block }), { nowSeconds: block.timestamp, maxHeadLagSeconds: 60n, expectedChainId: 4663 }))
      .rejects.toThrow(/chain 1/);
  });

  test("rejects an RPC that does not match the caller's expected supported chain", async () => {
    await expect(pinBlock(fakeChain({ chainId: 4663, block }), {
      nowSeconds: block.timestamp,
      maxHeadLagSeconds: 60n,
      expectedChainId: 46630,
    })).rejects.toThrow(/expected.*46630.*4663/);
  });

  test("a head older than budget is degraded, because no sequencer uptime feed exists to prove liveness", async () => {
    const fresh = await pinBlock(fakeChain({ block }), { nowSeconds: block.timestamp + 5n, maxHeadLagSeconds: 60n, expectedChainId: 4663 });
    expect(fresh.status).toBe("normal");
    expect(fresh.value).toMatchObject({ headLagSeconds: 5n });

    const lagging = await pinBlock(fakeChain({ block }), { nowSeconds: block.timestamp + 61n, maxHeadLagSeconds: 60n, expectedChainId: 4663 });
    expect(lagging).toMatchObject({ status: "degraded", reasons: ["head_lag"] });
    expect(lagging.provenance).toEqual({ kind: "onchain", chainId: 4663, block });
  });
});

describe("readFeed", () => {
  const withRound = (round: readonly bigint[]) =>
    fakeChain({
      block,
      calls: [
        { address: feed, abi: FEED_ABI, functionName: "latestRoundData", result: round },
        { address: feed, abi: FEED_ABI, functionName: "decimals", result: 8 },
      ],
    });

  test("judges freshness against the pinned block, not the wall clock", async () => {
    const round = await readFeed(withRound(liveRound), block, feed, HEARTBEAT);
    expect(round.status).toBe("normal");
    expect(round.value).toMatchObject({ answer: 33_974_221_248n, decimals: 8, ageSeconds: 29_147n });
  });

  test("an answer older than the heartbeat is stale, not zero", async () => {
    const round = await readFeed(withRound(liveRound), block, feed, 29_146n);
    expect(round).toMatchObject({ status: "degraded", reasons: ["stale"] });
    expect(round.value?.answer).toBe(33_974_221_248n);
  });

  test("a non-positive answer or incomplete round is invalid", async () => {
    const negative = await readFeed(withRound([1n, -1n, 1n, block.timestamp, 1n]), block, feed, HEARTBEAT);
    expect(negative.reasons).toContain("oracle_invalid");
    const incomplete = await readFeed(withRound([1n, 5n, 0n, 0n, 1n]), block, feed, HEARTBEAT);
    expect(incomplete.reasons).toContain("oracle_invalid");
  });


  test("an unreadable feed is unknown", async () => {
    const round = await readFeed(fakeChain({ block }), block, feed, HEARTBEAT);
    expect(round).toMatchObject({ status: "unknown", value: null, reasons: ["unreadable"] });
  });
});

describe("readCrestAccount", () => {
  test("returns unknown rather than fabricating account state when any pinned read fails", async () => {
    const incomplete = fakeChain({
      block,
      calls: [{ address: account, abi: CREST_ACCOUNT_ABI, functionName: "policy", result: policy }],
    });

    await expect(readCrestAccount(incomplete, block, account, loanToken)).resolves.toMatchObject({
      status: "unknown",
      value: null,
      reasons: ["unreadable"],
      provenance: { kind: "onchain", chainId: 4663, block },
    });
  });

  test("uses the supplied block for every account and reserve read", async () => {
    const chain = withAccountState();
    const readContract = chain.readContract.bind(chain);
    const readBlocks: bigint[] = [];
    const recordingChain = {
      ...chain,
      readContract: async (request: { blockNumber?: bigint }) => {
        readBlocks.push(request.blockNumber ?? -1n);
        return readContract(request as never);
      },
    } as unknown as PublicClient;

    const snapshot = await readCrestAccount(recordingChain, block, account, loanToken);

    expect(snapshot.status).toBe("normal");
    expect(readBlocks).toEqual([block.number, block.number, block.number, block.number, block.number, block.number, block.number]);
  });

  test("observes the exact nonce, frozen state, and reserve balance", async () => {
    const snapshot = await readCrestAccount(withAccountState({ frozen: true, nonce: 13n }), block, account, loanToken);

    expect(snapshot).toMatchObject({
      status: "normal",
      value: {
        account,
        borrowingFrozen: true,
        policyNonce: 13n,
        idleReserveAssets: 42n,
        policy: { owner: getAddress(owner), marketId, guardian: getAddress(guardian), yieldVault: getAddress(vault), market: { loanToken } },
      },
      provenance: { kind: "onchain", chainId: 4663, block },
    });
  });
});

describe("readCodeHash", () => {
  const code = "0x6080604052";
  const address = "0x9D53d5E3bd5E8d4CbfA6DB1ca238AEA02E651010";

  test("matches reviewed bytecode and flags any other code as an identity mismatch", async () => {
    const chain = fakeChain({ block, code: { [address]: code } });
    expect((await readCodeHash(chain, block, address, keccak256(code))).status).toBe("normal");
    expect(await readCodeHash(chain, block, address, `0x${"00".repeat(32)}`))
      .toMatchObject({ status: "degraded", reasons: ["identity_mismatch"], value: keccak256(code) });
  });

  test("an address without code is unknown", async () => {
    expect((await readCodeHash(fakeChain({ block }), block, address, keccak256(code))).status).toBe("unknown");
  });
});

describe("simulateCall", () => {
  const abi = parseAbi(["function withdraw(uint256 assets, address receiver, address owner) returns (uint256)"]);
  const vault = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";
  const owner = "0x00000000000000000000000000000000000000a1";
  const data = encodeFunctionData({ abi, functionName: "withdraw", args: [5n, owner, owner] });

  test("keeps the revert as evidence instead of hiding it", async () => {
    const chain = fakeChain({ block, calls: [{ address: vault, abi, functionName: "withdraw", args: [5n, owner, owner], revert: "gated" }] });
    const result = await simulateCall(chain, block, { from: owner, to: vault, data });
    expect(result.status).toBe("degraded");
    expect(result.reasons).toEqual(["simulation_reverted"]);
    expect(result.value).toMatchObject({ ok: false });
    expect(result.value?.ok === false && result.value.revert).toMatch(/gated/);
  });

  test("returns the exact return data of a successful call", async () => {
    const chain = fakeChain({ block, calls: [{ address: vault, abi, functionName: "withdraw", args: [5n, owner, owner], result: 7n }] });
    const result = await simulateCall(chain, block, { from: owner, to: vault, data });
    expect(result.status).toBe("normal");
    expect(result.value).toEqual({ ok: true, returnData: `0x${"7".padStart(64, "0")}` });
  });
});
