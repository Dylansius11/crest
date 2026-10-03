"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Cell, Fact } from "@/components/ui/cell";
import { activeTokens } from "@/lib/manifest";
import type { PositionHeadline } from "@/lib/position-headline";
import { AccountEvidence } from "./account-evidence";
import { CapitalPanel } from "./capital-panel";
import { CarryPanel } from "./carry-panel";
import { GuardianStateCard } from "./guardian-state-card";
import { KeyStrip } from "./key-strip";
import { LtvBandPanel } from "./ltv-band-panel";
import { RealizedCard } from "./realized-card";
import { StatusHeadline } from "./status-headline";
import { compactAddress, decimal, percentFromWad } from "./format";
import type { ReactNode } from "react";
import type { RecordedAccount, RecordedPosition } from "./types";

type Tab = "overview" | "manage" | "rules" | "evidence";
const { loan } = activeTokens;

export function AccountDashboard({ position, selectedAccount, positionNotice, nowMs, headline, inspect, inventory, entry, exit, policy }: {
  position: RecordedPosition | null;
  selectedAccount: RecordedAccount | null;
  positionNotice: string;
  nowMs: number;
  headline: PositionHeadline;
  inspect: boolean;
  inventory: ReactNode;
  entry: ReactNode;
  exit: ReactNode;
  policy: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const reducedMotion = useReducedMotion();
  const currentTab = inspect && tab === "manage" ? "overview" : tab;
  const snapshot = position?.snapshot;
  return <div className="mx-auto max-w-[85rem] px-5 py-8 sm:px-10 sm:py-12">
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-soft">
      {selectedAccount ? <span className="font-mono" title={selectedAccount.address}><span className="sm:hidden">{compactAddress(selectedAccount.address)}</span><span className="hidden sm:inline">{selectedAccount.address}</span></span> : <span>No account selected</span>}
      <span className="tnum">{position ? `Recorded at block ${snapshot?.blockNumber ?? "unavailable"} · ${snapshot ? `${new Date(snapshot.observedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC` : "snapshot pending"}` : positionNotice}</span>
      {inspect ? <span className="border border-ink px-2 py-1 text-ink">Read-only</span> : null}
    </div>
    <StatusHeadline headline={headline} />
    <div className="mt-8"><KeyStrip position={position} /></div>
    {inspect ? <p className="mt-5 text-sm text-ink-soft">Only the owner&apos;s wallet can manage this account. You can read its limits and evidence here.</p> : null}
    <div role="tablist" aria-label="Account views" className="mt-10 flex overflow-x-auto border-b border-ink">
      {(["overview", "manage", "rules", "evidence"] as const).filter((item) => !inspect || item !== "manage").map((item) => <button key={item} type="button" role="tab" aria-selected={currentTab === item} aria-controls="account-tab-panel" onClick={() => setTab(item)} className={`min-h-12 shrink-0 border-x border-t border-ink px-5 type-display text-poster-sm capitalize transition-colors duration-150 active:scale-[.97] focus-visible:outline-2 focus-visible:outline-crest-700 ${currentTab === item ? "bg-ink text-paper" : "bg-paper hover:bg-crest-100"}`}>{item}</button>)}
    </div>
    <motion.div key={currentTab} id="account-tab-panel" role="tabpanel" aria-label={`${currentTab} view`} className="min-w-0 pt-6" initial={reducedMotion ? false : { opacity: 0, filter: "blur(4px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}>
      {currentTab === "overview" ? snapshot && position ? <div className="grid gap-5">
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[5fr_7fr]"><GuardianStateCard position={position} nowMs={nowMs} /><LtvBandPanel position={position} /></div>
        <div className="grid min-w-0 items-start gap-5 lg:grid-cols-3"><CapitalPanel position={position} /><CarryPanel position={position} /><RealizedCard position={position} /></div>
      </div> : <div className="border border-ink p-5 text-sm" role="status">{position === null ? positionNotice : "The monitor has not recorded a snapshot for this account yet. Values stay unavailable, not zero."}</div> : null}
      {currentTab === "manage" && !inspect ? <div className="grid gap-5">{inventory}<div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">{entry}{exit}</div></div> : null}
      {currentTab === "rules" ? <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]">
        <Cell index="Current limits" meta={snapshot ? `Policy ${position?.account.policyNonce}` : "Not recorded"} className="bg-paper"><dl className="p-5">
          <Fact label="Lower LTV">{percentFromWad(snapshot?.lowerLtvWad)}</Fact>
          <Fact label="Target LTV">{percentFromWad(snapshot?.targetLtvWad)}</Fact>
          <Fact label="Upper LTV">{percentFromWad(snapshot?.upperLtvWad)}</Fact>
          <Fact label="Critical LTV">{percentFromWad(snapshot?.criticalLtvWad)}</Fact>
          <Fact label="Reserve floor">{decimal(snapshot?.reserveFloorAssets, loan.decimals, loan.symbol)}</Fact>
          <Fact label="Vault floor">{decimal(snapshot?.strategyFloorAssets, loan.decimals, loan.symbol)}</Fact>
          <Fact label="Maximum Custos repayment per action">{decimal(snapshot?.maxRepayPerActionAssets, loan.decimals, loan.symbol)}</Fact>
        </dl></Cell>
        {inspect ? <p className="border-t border-ink pt-4 text-sm text-ink-soft">These limits are read-only. Only the account owner can change them with a wallet signature.</p> : policy}
      </div> : null}
      {currentTab === "evidence" ? <AccountEvidence position={position} selectedAccount={selectedAccount} positionNotice={positionNotice} /> : null}
    </motion.div>
  </div>;
}

export function DashboardSkeleton({ notice }: { notice: string }) {
  if (notice !== "Loading recorded account registry.") {
    return <div className="mx-auto max-w-[85rem] px-5 py-10 sm:px-10" role="status"><h1 className="type-display text-poster-lg">Account registry unavailable</h1><p className="mt-3 max-w-[65ch] text-sm">{notice} You can still look up a recorded account from the header.</p></div>;
  }
  return <div className="mx-auto max-w-[85rem] px-5 py-10 sm:px-10" role="status" aria-label="Recorded account registry status">
    <p className="text-sm text-ink-soft">{notice}</p>
    <div className="mt-8 h-20 max-w-2xl border-t-2 border-ink bg-paper-soft" />
    <div className="mt-8 grid gap-px border border-ink bg-ink sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-32 bg-paper-soft p-5"><div className="h-3 w-20 bg-crest-100" /><div className="mt-5 h-6 w-32 max-w-full bg-crest-100" /></div>)}</div>
    <div className="mt-10 h-12 max-w-md border-b border-ink bg-paper-soft" />
  </div>;
}
