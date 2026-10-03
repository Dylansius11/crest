"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { SetupStep } from "./setup-step";
import type { RecordedAccount, TransactionEvidence, WalletState } from "./types";

const STEPS = [
  { title: "Connect wallet", purpose: "Choose the wallet that will own and sign for this account.", summary: "Owner wallet connected." },
  { title: "Choose assets", purpose: "Pick the stock token to protect and USDG for the fixed vault route.", summary: "Asset intent selected." },
  { title: "Create your account", purpose: "Deploy your Crest Account with your wallet. This step does not borrow.", summary: "Account registered." },
  { title: "Set your rules", purpose: "Set the limits Custos must follow, then review and sign your policy.", summary: "Policy configured." },
  { title: "Add collateral and borrow", purpose: "Supply collateral first. Borrow only if you choose to sign an owner transaction.", summary: "You can manage your position on the dashboard." },
];

export function SetupFlow({ wallet, registryNotice, selectedAccount, transaction, assetsChosen, inventory, deploy, policy, entry, onConnect, onSwitchNetwork, onBeginConfiguration, onFinish }: {
  wallet: WalletState;
  registryNotice: string;
  selectedAccount: RecordedAccount | null;
  transaction: TransactionEvidence;
  assetsChosen: boolean;
  inventory: ReactNode;
  deploy: ReactNode;
  policy: ReactNode;
  entry: ReactNode;
  onConnect(): void;
  onSwitchNetwork(): void;
  onBeginConfiguration(): void;
  onFinish(): void;
}) {
  const [step, setStep] = useState(0);
  const hasAccount = selectedAccount !== null;
  const configured = selectedAccount !== null && selectedAccount.policyNonce !== "0" || transaction.phase === "confirmed" && transaction.action === "configure";
  const minimum = wallet.kind !== "connected" ? 0 : !hasAccount ? 1 : !configured ? 3 : 4;
  const active = Math.max(step, minimum);
  const content = [
    <div key="wallet" className="grid gap-3">
      <p className="text-sm" role="status">{registryNotice}</p>
      {wallet.kind === "wrong-chain" ? <div className="grid gap-3 border border-signal-stop p-4" role="alert"><p className="text-sm">Your wallet is on chain {wallet.chainId}. Switch to {activeManifest.network.name} ({activeManifest.network.chainId}) before signing.</p><Button type="button" variant="solid" className="w-fit active:scale-[.97]" onClick={onSwitchNetwork}>Switch network</Button></div> : null}
      {wallet.kind === "disconnected" ? <Button type="button" variant="solid" className="w-fit active:scale-[.97]" onClick={onConnect}>Connect wallet</Button> : null}
      {wallet.kind === "connected" ? <p className="font-mono text-xs break-all">{wallet.address}</p> : null}
    </div>,
    inventory,
    deploy,
    policy,
    <div key="entry" className="grid gap-4">{entry}<p className="text-sm text-ink-soft">You may finish setup without borrowing. Only you can create debt.</p></div>,
  ];
  return <div className="mx-auto max-w-[85rem] px-5 py-8 sm:px-10 sm:py-12">
    <h1 className="type-display text-poster-xl leading-none sm:text-poster-2xl">Set up your account</h1>
    <p className="mt-4 max-w-[65ch] text-sm leading-relaxed sm:text-base">Your wallet approves each action. Custos may freeze new borrowing or repay this account&apos;s debt within your rules. It cannot borrow.</p>
    <ol aria-label="Setup progress" className="mt-8 border-x border-t border-ink">
      {STEPS.map(({ title, purpose, summary }, index) => <SetupStep key={title} number={index + 1} title={title} purpose={purpose} summary={summary} current={index === active} done={index < active} details={<><p>Chain: {activeManifest.network.name} ({activeManifest.network.chainId})</p><p>Morpho market: {activeManifest.market.id}</p><p>Collateral: {activeTokens.collateral.symbol} at {activeTokens.collateral.address}</p><p>Loan token: {activeTokens.loan.symbol} at {activeTokens.loan.address}</p><p>Vault: {activeManifest.vault.address}</p>{selectedAccount ? <p>Crest Account: {selectedAccount.address}</p> : null}</>}>
        {content[index]}
        <div className="mt-6 flex flex-wrap gap-3">
          {active > minimum ? <Button type="button" variant="outline" className="active:scale-[.97]" onClick={() => setStep(active - 1)}>Back</Button> : null}
          {active < 4 ? <Button type="button" variant="solid" className="active:scale-[.97]" disabled={active === 0 && wallet.kind !== "connected" || active === 1 && !assetsChosen || active === 2 && !hasAccount || active === 3 && !configured} onClick={() => { if (active + 1 >= 2 && active + 1 <= 3) onBeginConfiguration(); setStep(active + 1); }}>Continue</Button> : <Button type="button" variant="solid" className="active:scale-[.97]" onClick={onFinish}>Finish setup</Button>}
        </div>
      </SetupStep>)}
    </ol>
  </div>;
}
