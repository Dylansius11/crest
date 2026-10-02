import { Cell } from "@/components/ui/cell";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { EvidenceFact, EvidencePanel } from "./evidence-panel";
import { decimal, liquidityStatus, percentFromBps, percentFromWad } from "./format";
import type { RecordedAccount, RecordedPosition } from "./types";

const { collateral, loan } = activeTokens;

export function AccountEvidence({ position, selectedAccount, positionNotice }: {
  position: RecordedPosition | null;
  selectedAccount: RecordedAccount | null;
  positionNotice: string;
}) {
  const snapshot = position?.snapshot;
  const evidence = snapshot ? "recorded" : "unavailable";
  return (
    <section id="evidence" aria-label="Evidence and permissions" className="space-y-5 scroll-mt-6">
      <div className="flex flex-col justify-between gap-2 border-b border-ink pb-3 sm:flex-row sm:items-end">
        <div><p className="type-display text-poster-sm text-ink-soft">05 / Verification</p><h2 className="type-display text-poster-lg">Inspect the evidence</h2></div>
        <p className="max-w-md text-sm text-ink-soft">Records are block-scoped, not live. Open the source details before relying on a number.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <EvidencePanel title="Debt and policy health" evidence={evidence}>
          <EvidenceFact label="Debt">{decimal(snapshot?.debtAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Collateral">{decimal(snapshot?.collateralAssets, collateral.decimals, collateral.symbol)}</EvidenceFact>
          <EvidenceFact label="Collateral value">{decimal(snapshot?.collateralValueAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Current LTV">{percentFromWad(snapshot?.ltvWad)}</EvidenceFact>
          <EvidenceFact label="Morpho health">{decimal(snapshot?.morphoHealthWad, 18, "×")}</EvidenceFact>
          <EvidenceFact label="Owner LTV band">{snapshot ? `${percentFromWad(snapshot.lowerLtvWad)} / ${percentFromWad(snapshot.targetLtvWad)} / ${percentFromWad(snapshot.upperLtvWad)} / ${percentFromWad(snapshot.criticalLtvWad)}` : "Unavailable"}</EvidenceFact>
          <EvidenceFact label="No debt / floor">{snapshot?.debtAssets === "0" ? "No recorded debt" : "Reserve and strategy floors require the owner policy"}</EvidenceFact>
        </EvidencePanel>
        <EvidencePanel title="Capital allocation" evidence={evidence}>
          <EvidenceFact label="Idle reserve">{decimal(snapshot?.reserveAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Vault shares">{snapshot?.vaultShares ?? "Unavailable"}</EvidenceFact>
          <EvidenceFact label="Quoted vault assets">{decimal(snapshot?.quotedVaultAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Withdrawable vault assets">{decimal(snapshot?.withdrawableVaultAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Liquidity constraint">{liquidityStatus(snapshot?.quotedVaultAssets, snapshot?.withdrawableVaultAssets)}</EvidenceFact>
        </EvidencePanel>
        <EvidencePanel title="Projected vs realized" evidence={position?.assessment ? "recorded" : "unavailable"}>
          <EvidenceFact label="Assessment">{position?.assessment?.status ?? "Unavailable"}</EvidenceFact>
          <EvidenceFact label="Assessed at">{position?.assessment?.createdAt ?? "Unavailable"}</EvidenceFact>
          <EvidenceFact label="Reason codes">{position?.assessment?.reasonCodes.join(", ") || "Unavailable"}</EvidenceFact>
          <EvidenceFact label="Owner borrow capacity">{decimal(position?.assessment?.ownerBorrowCapacityAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Projected carry">{decimal(position?.assessment?.projectedCarryAssets, loan.decimals, loan.symbol)}</EvidenceFact>
          <EvidenceFact label="Projected spread">{percentFromBps(position?.assessment?.projectedSpreadBps)}</EvidenceFact>
          <EvidenceFact label="Realized debt repaid">{decimal(position?.realizedDebtRepaidAssets, loan.decimals, loan.symbol)}</EvidenceFact>
        </EvidencePanel>
      </div>
      <details className="group border border-ink bg-paper">
        <summary className="cursor-pointer px-4 py-4 type-display text-poster-base hover:bg-paper-soft">Exact account, route and provenance <span aria-hidden="true" className="float-right">+</span></summary>
        <div className="grid gap-4 border-t border-ink p-4 lg:grid-cols-2">
          <EvidencePanel title="Recorded position" evidence={evidence}>
            <EvidenceFact label="Status">{positionNotice}</EvidenceFact>
            <EvidenceFact label="Block">{snapshot?.blockNumber ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Block hash">{snapshot?.blockHash ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Observed at">{snapshot?.observedAt ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Account">{position?.account.address ?? selectedAccount?.address ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Code hash">{position?.account.codeHash ?? selectedAccount?.codeHash ?? "Unavailable"}</EvidenceFact>
            <EvidenceFact label="Borrowing frozen">{snapshot ? String(snapshot.frozen) : "Unavailable"}</EvidenceFact>
          </EvidencePanel>
          <EvidencePanel title="Active route" evidence="manifest">
            <EvidenceFact label="Trust tier">{activeManifest.trust.level === "sandbox" ? "SANDBOX, not reviewed evidence" : "Reviewed"}</EvidenceFact>
            <EvidenceFact label="Route gate">{activeManifest.gate.outcome}: market {activeManifest.gate.marketGate}, vault {activeManifest.gate.vaultGate}</EvidenceFact>
            <EvidenceFact label="Chain">{activeManifest.network.name} {activeManifest.network.chainId}</EvidenceFact>
            <EvidenceFact label="Market">{activeManifest.market.id}</EvidenceFact>
            <EvidenceFact label="Morpho LLTV">{percentFromWad(activeManifest.market.lltv)}</EvidenceFact>
            <EvidenceFact label="Vault">{activeManifest.vault.address}</EvidenceFact>
            <EvidenceFact label="Vault generation">{activeManifest.vault.generation}</EvidenceFact>
          </EvidencePanel>
        </div>
      </details>
      <Cell index="Who can act" meta="Onchain permissions" className="bg-paper">
        <div className="grid gap-px bg-ink md:grid-cols-3">
          <div className="bg-paper p-5"><p className="type-display text-poster-sm">Owner</p><p className="mt-2 text-sm">Configures policy, supplies collateral, approves every borrow, withdraws value and unfreezes.</p></div>
          <div className="bg-paper p-5"><p className="type-display text-poster-sm">Custos can</p><p className="mt-2 text-sm">Freeze borrowing and repay this account's own debt from its reserve or fixed vault.</p></div>
          <div className="bg-flame p-5"><p className="type-display text-poster-sm">Custos cannot</p><p className="mt-2 text-sm">Borrow, unfreeze, change policy, choose a receiver, sell collateral or call arbitrary targets.</p></div>
        </div>
      </Cell>
      <p className="border-l-2 border-signal-degraded pl-4 text-sm text-ink-soft">Only {collateral.symbol}/{loan.symbol} has an executable route on this deployment. Other tokens and asset-denominated yield are unsupported. A registered account without a canonical policy or snapshot is not an active position.</p>
    </section>
  );
}
