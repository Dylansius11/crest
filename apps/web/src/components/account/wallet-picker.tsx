"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { subscribeWallets } from "./wallet-discovery";
import type { DiscoveredWallet } from "./wallet-discovery";

export function WalletPicker({ open, busy, onSelect, onClose }: {
  open: boolean;
  busy: boolean;
  onSelect(wallet: DiscoveredWallet): void;
  onClose(): void;
}) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  useEffect(() => subscribeWallets(window, setWallets), []);
  if (!open) return null;

  return (
    <section aria-label="Choose a wallet" className="mt-5 max-w-2xl border border-ink bg-paper p-4 text-ink sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="type-display text-poster-md">Choose your wallet</h2>
          <p className="mt-2 max-w-prose text-sm text-ink-soft">Select the browser wallet that will own this account. Its name is supplied by the extension; verify the request in your wallet before approving.</p>
        </div>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Close</Button>
      </div>
      {wallets.length ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {wallets.map((wallet) => <button key={wallet.id} type="button" disabled={busy} onClick={() => onSelect(wallet)} className="min-h-14 border border-ink bg-paper-soft px-4 py-3 text-left type-display text-poster-base transition-colors hover:bg-crest-100 focus-visible:outline-2 disabled:opacity-50">{wallet.name}<span className="mt-1 block font-sans text-xs font-normal normal-case text-ink-soft">Connect with this provider</span></button>)}
        </div>
      ) : <p className="mt-5 border-l-2 border-signal-degraded pl-3 text-sm" role="status">No injected EVM wallet was detected in this browser. Install or unlock a compatible extension, then reopen this list.</p>}
    </section>
  );
}
