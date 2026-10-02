"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cell, Fact } from "@/components/ui/cell";
import { activeManifest } from "@/lib/manifest";
import { compactAddress } from "./format";
import type { TransactionEvidence, TransactionPhase } from "./types";

const PHASE: Record<TransactionPhase, { label: string; tone: "neutral" | "verified" | "warn" | "stop" | "degraded" }> = {
  idle: { label: "Nothing prepared", tone: "neutral" },
  blocked: { label: "Policy blocked", tone: "degraded" },
  simulating: { label: "Simulating", tone: "neutral" },
  "simulation-failed": { label: "Simulation failed", tone: "stop" },
  "signature-ready": { label: "Ready to sign", tone: "warn" },
  pending: { label: "Pending", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "verified" },
  reverted: { label: "Reverted", tone: "stop" },
  "reconciliation-failed": { label: "Reconciliation failed", tone: "stop" },
};

const explorer = activeManifest.network.explorerUrl.replace(/\/$/, "");

export function TransactionPanel({
  account,
  transaction,
  blockedReason,
  onSimulateConfiguration,
  onSubmitPrepared,
}: {
  account: string | null;
  transaction: TransactionEvidence;
  /** The lock that applies to the prepared action, if any. */
  blockedReason: string | null;
  onSimulateConfiguration(): void;
  onSubmitPrepared(): void;
}) {
  const phase = PHASE[transaction.phase];
  const readyToSign = transaction.phase === "signature-ready";
  const configurationPrepared = transaction.action === "configure" && transaction.calldata !== undefined && transaction.phase === "idle";

  return (
    <Cell id="owner-transaction" index="Owner transaction" meta={transaction.action?.replaceAll("-", " ") ?? "none"} className="bg-paper" tabIndex={-1} aria-labelledby="owner-transaction-title">
      <div className="grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="owner-transaction-title" className="type-display text-poster-base">Simulate, then sign</p>
          <Badge tone={phase.tone} className={transaction.phase === "simulating" || transaction.phase === "pending" ? "motion-safe:animate-pulse" : undefined}>{phase.label}</Badge>
        </div>
        <p className="text-sm" role="status" aria-live="polite">{transaction.detail}</p>
        {blockedReason && (readyToSign || configurationPrepared) ? <p className="border-l-2 border-signal-degraded pl-3 text-sm" role="note">Locked: {blockedReason}</p> : null}
        {configurationPrepared ? <Button type="button" variant="outline" className="w-full" disabled={blockedReason !== null} onClick={onSimulateConfiguration}>Simulate configuration</Button> : null}
        {readyToSign ? <Button type="button" variant="flame" className="w-full" disabled={blockedReason !== null} onClick={onSubmitPrepared}>Request owner signature</Button> : null}
        <dl>
          <Fact label="Chain">{activeManifest.network.name} {activeManifest.network.chainId}</Fact>
          <Fact label="Crest Account">{compactAddress(account)}</Fact>
          <Fact label="Recipient contract">{compactAddress(transaction.recipient)}</Fact>
          <Fact label="Selector">{transaction.selector ?? "Not prepared"}</Fact>
          <Fact label="Estimated gas">{transaction.gas?.toString() ?? "Not simulated"}</Fact>
          <Fact label="Simulation block">{transaction.blockNumber?.toString() ?? "Not simulated"}</Fact>
          <Fact label="Transaction">
            {transaction.hash
              ? <a className="underline underline-offset-4" href={`${explorer}/tx/${transaction.hash}`} target="_blank" rel="noopener noreferrer">{compactAddress(transaction.hash)} ↗</a>
              : "Not submitted"}
          </Fact>
        </dl>
        {transaction.calldata ? (
          <details className="border border-ink">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm">Exact calldata and block hash</summary>
            <div className="grid gap-2 border-t border-ink p-3 font-mono text-xs break-all">
              <p>{transaction.calldata}</p>
              <p>Block hash: {transaction.blockHash ?? "Not simulated"}</p>
            </div>
          </details>
        ) : null}
      </div>
    </Cell>
  );
}
