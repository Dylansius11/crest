"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { activeManifest } from "@/lib/manifest";
import { compactAddress } from "./format";
import { SandboxNotice } from "./sandbox-notice";
import { WalletPicker } from "./wallet-picker";
import type { DiscoveredWallet } from "./wallet-discovery";
import type { RecordedAccount, RecordedRegistry, WalletState, TransactionPhase } from "./types";

export function AccountHeader({ wallet, walletName, walletPickerOpen, setWalletPickerOpen, connect, disconnect, registry, selectedAccount, onSelectAccount, inspectAddress, setInspectAddress, inspectNotice, inspect, phase }: {
  wallet: WalletState;
  walletName: string | null;
  walletPickerOpen: boolean;
  setWalletPickerOpen(open: boolean): void;
  connect(choice: DiscoveredWallet): void;
  disconnect(): void;
  registry: RecordedRegistry | null;
  selectedAccount: RecordedAccount | null;
  onSelectAccount(account: RecordedAccount): void;
  inspectAddress: string;
  setInspectAddress(address: string): void;
  inspectNotice: string;
  inspect(): void;
  phase: TransactionPhase;
}) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const locked = phase === "pending" || phase === "reconciliation-failed";
  const accounts = registry?.accounts.filter((account) => account.chainId === String(activeManifest.network.chainId)) ?? [];
  return (
    <header className="blue-field blue-grid border-b border-ink px-5 py-4 text-paper sm:px-10">
      <div className="mx-auto max-w-[85rem]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
          <a href="/" aria-label="Crest home" className="mr-6 inline-flex min-h-14 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"><Logo height={56} priority className="h-14" /></a>
          <div className="order-3 flex w-full gap-2 sm:order-2 sm:ml-auto sm:w-auto">
            {activeManifest.trust.level === "sandbox" ? <button type="button" popoverTarget="sandbox-disclosures" className="min-h-11 flex-1 border border-paper px-3 text-sm transition-colors duration-150 hover:bg-crest-700 active:scale-[.97] focus-visible:outline-2 focus-visible:outline-paper sm:flex-none">Sandbox<span className="hidden sm:inline">: read disclosures</span><span className="sr-only sm:hidden">: read disclosures</span></button> : null}
            <button type="button" aria-expanded={lookupOpen} onClick={() => setLookupOpen(!lookupOpen)} className="min-h-11 flex-1 border border-paper px-3 text-sm transition-colors duration-150 hover:bg-crest-700 active:scale-[.97] focus-visible:outline-2 focus-visible:outline-paper sm:flex-none">Look up an account</button>
          </div>
          <div className="order-2 ml-auto flex flex-wrap items-center justify-end gap-2 sm:order-3 sm:ml-0">
            {wallet.kind === "connected" ? <>
              <span className="min-h-11 content-center border border-paper px-3 font-mono text-xs">{walletName ? `${walletName}: ` : ""}{compactAddress(wallet.address)}</span>
              <Button type="button" variant="paper" onClick={() => { disconnect(); setWalletPickerOpen(true); }} disabled={locked}>Change wallet</Button>
              <Button type="button" variant="paper" onClick={disconnect} disabled={locked}>Disconnect</Button>
            </> : <Button type="button" variant="paper" onClick={() => setWalletPickerOpen(!walletPickerOpen)} disabled={wallet.kind === "connecting"}>{wallet.kind === "connecting" ? "Connecting" : "Connect wallet"}</Button>}
          </div>
        </div>
        {wallet.kind === "connected" && accounts.length > 1 ? <label className="mt-4 flex flex-wrap items-center gap-3 text-sm">Your accounts
          <select aria-label="Switch account" value={accounts.some((account) => account.address.toLowerCase() === selectedAccount?.address.toLowerCase()) ? selectedAccount?.address : ""} disabled={locked} onChange={(event) => { const account = accounts.find((item) => item.address === event.target.value); if (account) onSelectAccount(account); }} className="min-h-11 min-w-0 max-w-full border border-ink bg-paper px-3 font-mono text-xs text-ink focus-visible:outline-2 focus-visible:outline-paper">
            {accounts.map((account) => <option key={account.address} value={account.address}>{compactAddress(account.address)} · policy {account.policyNonce}</option>)}
          </select>
        </label> : null}
        {wallet.kind === "connected" && accounts.length > 0 && !accounts.some((account) => account.address.toLowerCase() === selectedAccount?.address.toLowerCase()) ? <button type="button" disabled={locked} onClick={() => { const account = accounts[0]; if (account) onSelectAccount(account); }} className="mt-3 min-h-11 border border-paper px-3 text-sm transition-colors duration-150 hover:bg-crest-700 active:scale-[.97] focus-visible:outline-2 focus-visible:outline-paper">Return to your account</button> : null}
        {lookupOpen ? <form id="account-lookup" className="mt-5 grid max-w-2xl gap-2 border-t border-paper pt-4 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); inspect(); }}>
          <label className="grid gap-1 text-sm">Crest Account address<input value={inspectAddress} onChange={(event) => setInspectAddress(event.target.value)} placeholder="0x..." spellCheck={false} autoComplete="off" className="min-h-11 w-full min-w-0 border border-ink bg-paper px-3 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-paper" /></label>
          <Button type="submit" variant="paper" disabled={locked}>Read account</Button>
          {inspectNotice ? <p className="text-sm sm:col-span-2" role="status">{inspectNotice}</p> : null}
        </form> : null}
        <WalletPicker open={walletPickerOpen} busy={wallet.kind === "connecting"} onSelect={connect} onClose={() => setWalletPickerOpen(false)} />
      </div>
      {activeManifest.trust.level === "sandbox" ? <div id="sandbox-disclosures" popover="auto" className="m-auto max-h-[85dvh] w-[min(95vw,52rem)] overflow-y-auto border border-ink bg-paper text-ink shadow-[6px_6px_0_0_#0a1626]"><SandboxNotice manifest={activeManifest} /></div> : null}
    </header>
  );
}
