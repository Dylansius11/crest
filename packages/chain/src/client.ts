import { createPublicClient, defineChain, http } from "viem";
import type { PublicClient } from "viem";

import { observe } from "@crest/domain";
import type { BlockRef, Observation, Provenance } from "@crest/domain";

export const ROBINHOOD_CHAIN_ID = 4663;

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

/**
 * The runtime read client. The endpoint is always explicit: adapters never fall back to a public or local RPC,
 * because a silently substituted endpoint would make every downstream observation unattributable.
 */
export function createRobinhoodClient(rpcUrl: string | undefined): PublicClient {
  if (!rpcUrl) throw new Error("ROBINHOOD_CHAIN_RPC_URL is required; Crest adapters refuse to guess an endpoint");
  return createPublicClient({ chain: robinhoodChain, transport: http(rpcUrl, { retryCount: 2 }) });
}

/** Every onchain read is bound to one block so a snapshot has one coherent horizon. */
export function onchainAt(block: BlockRef): Provenance {
  return { kind: "onchain", chainId: ROBINHOOD_CHAIN_ID, block };
}

export interface PinnedBlock {
  block: BlockRef;
  headLagSeconds: bigint;
}

export interface PinOptions {
  /** Wall-clock seconds at pin time. Injected so freshness is testable and never implicit. */
  nowSeconds: bigint;
  /**
   * Robinhood Chain has no Chainlink L2 sequencer uptime feed, so head freshness is the only liveness signal
   * available. A head older than this budget degrades every observation read against it.
   */
  maxHeadLagSeconds: bigint;
}

/**
 * Pins the current head as the read horizon. A wrong chain is not a degraded read, it is the wrong system:
 * this throws instead of returning an observation anyone could mistake for Robinhood state.
 */
export async function pinBlock(client: PublicClient, options: PinOptions): Promise<Observation<PinnedBlock>> {
  const chainId = await client.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`expected Robinhood Chain ${ROBINHOOD_CHAIN_ID}, RPC reports chain ${chainId}`);
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.hash === null || head.number === null) throw new Error("latest block has no hash; refusing a pending horizon");
  const block: BlockRef = { number: head.number, hash: head.hash, timestamp: head.timestamp };
  const headLagSeconds = options.nowSeconds > block.timestamp ? options.nowSeconds - block.timestamp : 0n;
  return observe({ block, headLagSeconds }, onchainAt(block), headLagSeconds > options.maxHeadLagSeconds ? ["head_lag"] : []);
}
