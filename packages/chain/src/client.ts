import { createPublicClient, defineChain, http } from "viem";
import type { Chain, PublicClient } from "viem";

import { observe } from "@crest/domain";
import type { BlockRef, Observation, Provenance } from "@crest/domain";

const ROBINHOOD_CHAINS = {
  4663: {
    name: "Robinhood Chain",
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    explorerUrl: "https://robinhoodchain.blockscout.com",
  },
  46630: {
    name: "Robinhood Chain Testnet",
    rpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  },
} as const;

export function robinhoodChainOf(chainId: number): Chain {
  const route = ROBINHOOD_CHAINS[chainId as keyof typeof ROBINHOOD_CHAINS];
  if (route === undefined) throw new Error(`unsupported Robinhood chain ${chainId}`);
  return defineChain({
    id: chainId,
    name: route.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [route.rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: route.explorerUrl } },
  });
}

/**
 * The runtime read client. The endpoint is always explicit: adapters never fall back to a public or local RPC,
 * because a silently substituted endpoint would make every downstream observation unattributable.
 */
export function createRobinhoodClient(rpcUrl: string | undefined, chainId: number): PublicClient {
  if (!rpcUrl) throw new Error("ROBINHOOD_CHAIN_RPC_URL is required; Crest adapters refuse to guess an endpoint");
  return createPublicClient({ chain: robinhoodChainOf(chainId), transport: http(rpcUrl, { retryCount: 2 }) });
}

/** Every onchain read is bound to one block and chain so a snapshot has one coherent horizon. */
export function onchainAt(block: BlockRef, chainId: number): Provenance {
  return { kind: "onchain", chainId, block };
}

/** Provenance for an adapter read: the chain comes from the client, never from a default. */
export function readProvenance(client: PublicClient, block: BlockRef): Provenance {
  if (client.chain === undefined) throw new Error("onchain adapter requires a chain-configured client");
  return onchainAt(block, client.chain.id);
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
  /** The selected deployment-manifest chain; an RPC disagreement is always fatal. */
  expectedChainId: number;
}

/**
 * Pins the current head as the read horizon. A wrong chain is not a degraded read, it is the wrong system:
 * this throws instead of returning an observation anyone could mistake for Robinhood state.
 */
export async function pinBlock(client: PublicClient, options: PinOptions): Promise<Observation<PinnedBlock>> {
  const chainId = await client.getChainId();
  if (chainId !== options.expectedChainId) throw new Error(`expected Robinhood Chain ${options.expectedChainId}, RPC reports chain ${chainId}`);
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.hash === null || head.number === null) throw new Error("latest block has no hash; refusing a pending horizon");
  const block: BlockRef = { number: head.number, hash: head.hash, timestamp: head.timestamp };
  const headLagSeconds = options.nowSeconds > block.timestamp ? options.nowSeconds - block.timestamp : 0n;
  return observe({ block, headLagSeconds }, onchainAt(block, options.expectedChainId), headLagSeconds > options.maxHeadLagSeconds ? ["head_lag"] : []);
}
