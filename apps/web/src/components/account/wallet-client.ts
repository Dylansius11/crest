import { createPublicClient, http } from "viem";

import { robinhoodChainOf } from "@crest/chain";

import { activeManifest } from "../../lib/manifest";

export const activeChain = robinhoodChainOf(activeManifest.network.chainId);

/**
 * Browser reads go through the same-origin `/rpc` rewrite (see `next.config.ts`), so a locally hijacked public
 * hostname cannot silently break, or impersonate, the read path. The server forwards to `CREST_RPC_UPSTREAM`.
 */
export const publicClient = createPublicClient({ chain: activeChain, transport: http("/rpc", { retryCount: 2 }) });

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void): void;
  removeListener?(event: "accountsChanged" | "chainChanged" | "disconnect", listener: (...args: unknown[]) => void): void;
};

let selectedProvider: Eip1193Provider | null = null;

export function selectProvider(provider: Eip1193Provider | null): void {
  selectedProvider = provider;
}

export function providerOf(): Eip1193Provider | null {
  return selectedProvider;
}

/** Asks the wallet to switch to the active chain, adding it from manifest parameters when the wallet lacks it. */
export async function switchToActiveChain(provider: Eip1193Provider): Promise<void> {
  const chainId = `0x${activeManifest.network.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if ((error as { code?: number } | null)?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: activeManifest.network.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [activeManifest.network.rpcUrl],
        blockExplorerUrls: [activeManifest.network.explorerUrl],
      }],
    });
  }
}
