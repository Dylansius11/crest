import { Badge } from "@/components/ui/badge";
import { Cell } from "@/components/ui/cell";
import { activeTokens } from "@/lib/manifest";
import { capitalView } from "@/lib/position-view";
import { cn } from "@/lib/cn";
import { decimal } from "./format";
import type { RecordedPosition } from "./types";

const { collateral, loan } = activeTokens;
const amount = (value: string | null | undefined) => decimal(value, loan.decimals, loan.symbol);

function Row({ label, value, note, tone = "plain" }: { label: string; value: string; note?: string; tone?: "plain" | "muted" | "strong" }) {
  return (
    <div className={cn("flex flex-col gap-1 border-b border-dashed border-ink/25 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4", tone === "strong" && "border-solid border-ink bg-crest-100 px-3 -mx-3")}>
      <dt className="min-w-0">
        <span className={cn("type-display text-poster-sm uppercase", tone === "muted" ? "text-ink-soft" : "text-ink")}>{label}</span>
        {note ? <span className="mt-0.5 block text-xs text-ink-soft">{note}</span> : null}
      </dt>
      <dd className={cn("tnum shrink-0 font-mono break-all", tone === "strong" ? "text-poster-base" : "text-poster-sm", tone === "muted" && "text-ink-soft")}>{value}</dd>
    </div>
  );
}

/**
 * Capital allocation (DESIGN-SYSTEMS 7.4). The ordering and weight make one fact unmissable: quoted vault assets
 * are not repayable liquidity. Guardian-actionable is the engine's own repayment capacity, never recomputed here.
 */
export function CapitalPanel({ position }: { position: RecordedPosition }) {
  const snapshot = position.snapshot;
  if (snapshot === null) return null;
  const view = capitalView(snapshot, position.assessment);
  return (
    <Cell index="Capital" meta="Recorded" className="bg-paper">
      <div className="p-5 sm:p-6">
        <div className="flex min-h-8 flex-wrap gap-2">
          {view.constrained ? <Badge tone="warn">Withdrawal constrained</Badge> : null}
          {view.vaultLoss ? <Badge tone="stop">Vault loss</Badge> : null}
          {view.floorReached ? <Badge tone="warn">Floor reached</Badge> : null}
          {!view.constrained && !view.vaultLoss && !view.floorReached ? <span className="text-sm text-ink-soft">No recorded liquidity constraint.</span> : null}
        </div>
        <dl className="mt-3">
          <Row label="Collateral in Morpho" value={decimal(snapshot.collateralAssets, collateral.decimals, collateral.symbol)} />
          <Row label="Morpho collateral APY" value="0.00%" note="Collateral earns nothing in Morpho; yield comes only from deployed loan tokens." />
          <Row label="Accrued debt" value={amount(snapshot.debtAssets)} />
          <Row label="Idle reserve" value={amount(snapshot.reserveAssets)} note={`Floor ${amount(snapshot.reserveFloorAssets)}`} />
          <Row label="Vault quoted assets" value={amount(snapshot.quotedVaultAssets)} note="What the shares are worth on paper. Not repayable on its own." tone="muted" />
          <Row label="Currently withdrawable" value={amount(snapshot.withdrawableVaultAssets)} note={`Bounded by vault liquidity now. Strategy floor ${amount(snapshot.strategyFloorAssets)}`} />
          <Row label="Guardian-actionable" value={view.actionableAssets === null ? "Not assessed" : amount(view.actionableAssets.toString())} note={`One repayment, capped at ${amount(snapshot.maxRepayPerActionAssets)} and above both floors.`} tone="strong" />
        </dl>
      </div>
    </Cell>
  );
}
