import type { WalletState } from "@/components/account/types";

/** What the account page shows: a welcome, a guided setup, an owner dashboard, or a read-only look-up. */
export type AccountMode = "welcome" | "loading" | "setup" | "dashboard" | "inspect";

export type AccountModeInput = {
  wallet: WalletState;
  /** The connected owner's registry has answered for the active chain. */
  registryLoaded: boolean;
  /** Registered accounts for the connected owner on the active chain. */
  registryCount: number;
  /** The account on screen; `owner` comes from its recorded snapshot and is `null` when none exists. */
  selected: { policyNonce: string; owner: string | null; lookedUp: boolean } | null;
  /** The owner started deploying or configuring in this session, so the guide stays open until they finish. */
  setupInProgress: boolean;
};

/**
 * Derives the account page mode. A look-up is read-only unless the connected wallet is the recorded owner, so
 * owner controls never appear for an account the wallet cannot sign for.
 */
export function accountMode({ wallet, registryLoaded, registryCount, selected, setupInProgress }: AccountModeInput): AccountMode {
  if (selected?.lookedUp) {
    const owns = wallet.kind === "connected" && selected.owner !== null && selected.owner.toLowerCase() === wallet.address.toLowerCase();
    if (!owns) return "inspect";
  }
  if (wallet.kind === "disconnected" || wallet.kind === "connecting") return selected === null ? "welcome" : "inspect";
  if (wallet.kind === "wrong-chain") return "setup";
  if (!registryLoaded) return "loading";
  if (setupInProgress) return "setup";
  if (selected === null) return registryCount === 0 ? "setup" : "loading";
  return selected.policyNonce === "0" ? "setup" : "dashboard";
}
