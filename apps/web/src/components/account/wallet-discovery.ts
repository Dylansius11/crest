import type { Eip1193Provider } from "./wallet-client";

export type DiscoveredWallet = { id: string; name: string; provider: Eip1193Provider };

type WalletTarget = EventTarget & { ethereum?: Eip1193Provider };

/** EIP-6963 providers take precedence; window.ethereum is a single-wallet fallback only. */
export function subscribeWallets(target: WalletTarget, onChange: (wallets: DiscoveredWallet[]) => void): () => void {
  const announced = new Map<string, DiscoveredWallet>();
  const publish = () => onChange(announced.size > 0
    ? [...announced.values()]
    : target.ethereum && typeof target.ethereum.request === "function"
      ? [{ id: "legacy", name: "Browser wallet", provider: target.ethereum }]
      : []);
  const announce = (event: Event) => {
    const detail = (event as Event & { detail?: unknown }).detail;
    if (!detail || typeof detail !== "object" || !("info" in detail) || !("provider" in detail)) return;
    const { info, provider } = detail;
    if (!info || typeof info !== "object" || !("uuid" in info) || !("name" in info)
      || typeof info.uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(info.uuid)
      || typeof info.name !== "string" || !info.name.trim() || typeof provider !== "object" || provider === null
      || !("request" in provider) || typeof provider.request !== "function") return;
    if (announced.has(info.uuid) || [...announced.values()].some((wallet) => wallet.provider === provider)) return;
    announced.set(info.uuid, { id: info.uuid, name: info.name.trim().slice(0, 64), provider: provider as Eip1193Provider });
    publish();
  };
  target.addEventListener("eip6963:announceProvider", announce);
  publish();
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => target.removeEventListener("eip6963:announceProvider", announce);
}
