import { Cell } from "@/components/ui/cell";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { EvidenceFact, EvidencePanel } from "./evidence-panel";
import { ProvenanceTable } from "./provenance-table";
import { RouteVerification } from "./route-verification";
import type { RecordedAccount, RecordedPosition } from "./types";

const { collateral, loan } = activeTokens;

const PERMISSIONS = [
  { title: "Owner can", tone: "bg-paper", items: ["configure policy", "supply collateral", "borrow and deploy", "repay", "withdraw strategy, reserve, collateral", "unfreeze", "change or revoke Guardian"] },
  { title: "Custos can", tone: "bg-crest-100", items: ["freezeBorrowing()", "repayFromReserve(uint256)", "repayFromStrategy(uint256)", "only this account's own debt, within cap and floors"] },
  { title: "Custos cannot", tone: "bg-flame", items: ["borrow", "unfreeze", "choose a venue or receiver", "transfer or approve", "swap or sell collateral", "change policy", "call arbitrary targets"] },
] as const;

/**
 * Permission inspector (DESIGN-SYSTEMS 7.8): three equal cells on one grid. The Guardian-cannot cell carries the
 * flame plate and is never larger than its siblings. Custos selectors are the contract's complete Guardian surface.
 */
function PermissionInspector() {
  return (
    <Cell index="Who can act" meta="Onchain permissions" className="bg-paper">
      <div className="grid gap-px bg-ink md:grid-cols-3">
        {PERMISSIONS.map((cell) => (
          <div key={cell.title} className={`${cell.tone} flex flex-col p-5`}>
            <p className="type-display text-poster-base">{cell.title}</p>
            <ul className="mt-3 grid gap-1.5 text-sm">
              {cell.items.map((item) => <li key={item} className={item.includes("(") ? "font-mono text-xs" : undefined}>{item}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </Cell>
  );
}

export function AccountEvidence({ position, selectedAccount, positionNotice }: {
  position: RecordedPosition | null;
  selectedAccount: RecordedAccount | null;
  positionNotice: string;
}) {
  const snapshot = position?.snapshot ?? null;
  return (
    <section id="evidence" aria-label="Evidence and permissions" className="space-y-5 scroll-mt-6">
      <div className="flex flex-col justify-between gap-2 border-b border-ink pb-3 sm:flex-row sm:items-end">
        <h2 className="type-display text-poster-lg">Inspect the evidence</h2>
        <p className="max-w-md text-sm text-ink-soft">Who may act, the exact route re-read live, and where every assessed input came from.</p>
      </div>
      <PermissionInspector />
      <RouteVerification />
      <ProvenanceTable rows={position?.assessment?.provenance ?? []} assessedAt={position?.assessment?.createdAt ?? null} />
      <details className="group border border-ink bg-paper">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between px-4 type-display text-poster-base hover:bg-paper-soft">Exact account record <span aria-hidden="true" className="transition-transform group-open:rotate-45">+</span></summary>
        <div className="border-t border-ink p-4">
          <EvidencePanel title="Recorded account" evidence={snapshot ? "recorded" : "unavailable"}>
            <EvidenceFact label="Status">{positionNotice}</EvidenceFact>
            <EvidenceFact label="Account">{position?.account.address ?? selectedAccount?.address ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Registry status">{position?.account.status ?? selectedAccount?.status ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Code hash">{position?.account.codeHash ?? selectedAccount?.codeHash ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Policy nonce">{position?.account.policyNonce ?? selectedAccount?.policyNonce ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Owner">{snapshot?.owner ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Guardian">{snapshot?.guardian ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Snapshot block">{snapshot?.blockNumber ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Block hash">{snapshot?.blockHash ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Observed at">{snapshot?.observedAt ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Manifest integrity">{activeManifest.integrity.digest}</EvidenceFact>
          </EvidencePanel>
        </div>
      </details>
      <p className="border-l-2 border-signal-degraded pl-4 text-sm text-ink-soft">Only {collateral.symbol}/{loan.symbol} has an executable route on this deployment. Other tokens and asset-denominated yield are unsupported. A registered account without a canonical policy or snapshot is not an active position.</p>
    </section>
  );
}
