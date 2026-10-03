import { activeTokens } from "../../lib/manifest";
import { interventionView } from "../../lib/position-view";
import { decimal, percentFromWad } from "./format";
import type { RecordedPosition } from "./types";

const { collateral, loan } = activeTokens;

export function KeyStrip({ position }: { position: RecordedPosition | null }) {
  const snapshot = position?.snapshot;
  const last = interventionView(position?.latestIntervention ?? null);
  const skipped = last?.run?.failureClass === "pre_sign_validation_or_simulation" && !last.run.transactionHash;
  const facts = [
    { label: "Debt", value: decimal(snapshot?.debtAssets, loan.decimals, loan.symbol), note: "Recorded at the snapshot block" },
    { label: "Current LTV", value: snapshot?.debtAssets === "0" ? "0.00%" : percentFromWad(snapshot?.ltvWad), note: !snapshot ? "No snapshot yet" : snapshot.debtAssets === null ? "Debt is unavailable, so LTV cannot be calculated" : snapshot.ltvWad === null && snapshot.debtAssets !== "0" ? `No collateral valuation. Your target ${percentFromWad(snapshot.targetLtvWad)} · upper ${percentFromWad(snapshot.upperLtvWad)}` : `Your target ${percentFromWad(snapshot.targetLtvWad)} · upper ${percentFromWad(snapshot.upperLtvWad)}` },
    { label: "Collateral", value: decimal(snapshot?.collateralAssets, collateral.decimals, collateral.symbol), note: "In Morpho, not in your wallet" },
    { label: "Withdrawable from vault", value: decimal(snapshot?.withdrawableVaultAssets, loan.decimals, loan.symbol), note: "Not the quoted value of vault shares" },
    { label: "Custos last action", value: !last ? "None recorded" : skipped ? "Skipped before signing" : last.outcome === "verified" ? "Verified" : last.outcome.replaceAll("-", " "), note: !last ? "No intervention on record" : skipped ? "Nothing was signed" : last.actionKind.replaceAll("_", " ") },
  ];
  return <section aria-label="Account at a glance" className="grid grid-cols-2 gap-px border border-ink bg-ink xl:grid-cols-5">
    <p className="sr-only">These values come from recorded evidence, not live quotes. Unavailable values are not zero.</p>
    {facts.map((fact) => <div key={fact.label} className="min-w-0 bg-paper p-4 last:col-span-2 sm:p-5 xl:last:col-span-1">
      <p className="text-xs font-medium text-ink-soft">{fact.label}</p>
      <p className="tnum mt-3 break-words font-mono text-base leading-tight sm:text-lg">{fact.value}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{fact.note}</p>
    </div>)}
  </section>;
}
