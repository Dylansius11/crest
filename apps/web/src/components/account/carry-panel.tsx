import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Cell } from "@/components/ui/cell";
import { activeTokens } from "@/lib/manifest";
import { percentFromBpsValue, rateView, spreadView, type RateView } from "@/lib/position-view";
import { decimal, percentFromBps } from "./format";
import type { RecordedInput, RecordedPosition } from "./types";

const { loan } = activeTokens;

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = { normal: "verified", degraded: "degraded", unknown: "degraded" };

function RateRow({ label, sign, rate }: { label: string; sign: "+" | "-"; rate: RateView }) {
  return (
    <div className="border-b border-dashed border-ink/25 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <dt className="type-display text-poster-sm uppercase">{label}</dt>
        <dd className="tnum font-mono text-poster-base">{rate.bps === null ? "Not read" : `${sign}${percentFromBpsValue(rate.bps)}`}</dd>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <Badge tone={STATUS_TONE[rate.status] ?? "degraded"} className="px-2 py-1 text-[0.65rem]">{rate.status}</Badge>
        {rate.reasons.length > 0 ? <span className="font-mono">{rate.reasons.join(", ")}</span> : null}
        {rate.basis ? <span>{rate.basis}</span> : null}
      </div>
      <p className="mt-1 font-mono text-[0.7rem] break-all text-ink-soft">{rate.source ?? "No source recorded"}{rate.observedAt ? ` · ${rate.observedAt}` : ""}</p>
    </div>
  );
}

function StatusRow({ label, input }: { label: string; input: RecordedInput | undefined }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-dashed border-ink/25 py-3 last:border-b-0">
      <dt className="type-display text-poster-sm text-ink-soft uppercase">{label}</dt>
      <dd className="font-mono text-xs text-ink-soft">{input === undefined ? "Not recorded" : `${input.status}${input.reasons.length > 0 ? `: ${input.reasons.join(", ")}` : ""}`}</dd>
    </div>
  );
}

/**
 * Carry breakdown (DESIGN-SYSTEMS 7.5): both rate sides with their own source, time, and status, then a net spread
 * only when the two are comparable. Everything here is a projection; realized repayment lives in its own card.
 */
export function CarryPanel({ position }: { position: RecordedPosition }) {
  const assessment = position.assessment;
  if (assessment === null) {
    return (
      <Cell index="Carry" meta="Projected" className="bg-paper">
        <p className="p-5 text-sm text-ink-soft sm:p-6">No assessment is recorded, so no rate was read and no carry is projected.</p>
      </Cell>
    );
  }
  const borrow = rateView(assessment.rates.borrow);
  const vault = rateView(assessment.rates.vault);
  const spread = spreadView(assessment.rates.borrow, assessment.rates.vault);
  const input = (name: string) => assessment.provenance.find((row) => row.input === name);
  const width = (bps: bigint | null) => (bps === null ? 0 : Math.min(100, Number(bps) / 20));

  return (
    <Cell index="Carry" meta="Projected" className="bg-paper">
      <div className="p-5 sm:p-6">
        <p className="text-sm text-ink-soft">Projection from recorded rates. It is not earnings and never counts as debt repaid.</p>
        {borrow.bps !== null && vault.bps !== null ? (
          <div className="mt-4 grid gap-1" aria-hidden>
            <span className="h-3 bg-crest-600" style={{ width: `${width(vault.bps)}%` }} />
            <span className="h-3 bg-flame" style={{ width: `${width(borrow.bps)}%` }} />
          </div>
        ) : null}
        <dl className="mt-3">
          <RateRow label="Vault APY" sign="+" rate={vault} />
          <RateRow label="Borrow APY" sign="-" rate={borrow} />
          <StatusRow label="Vault fees" input={input("rates.fees")} />
          <StatusRow label="Vault incentives" input={input("rates.vaultIncentives")} />
          <StatusRow label="Market incentives" input={input("rates.marketIncentives")} />
        </dl>
        <div className="mt-4 border-t border-ink pt-4">
          <p className="type-display text-poster-sm uppercase">Estimated net spread</p>
          {spread.kind === "net" ? (
            <p className="tnum mt-1 font-mono text-poster-md">{spread.bps > 0n ? "+" : ""}{percentFromBpsValue(spread.bps)}{spread.inverted ? <span className="mt-1 block font-sans text-sm text-signal-stop">Inverted: borrowing costs more than the vault earns.</span> : null}</p>
          ) : (
            <p className="mt-1 text-sm">No net value shown. {spread.reason}</p>
          )}
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="type-display text-poster-sm uppercase">Projected annual carry</span>
            <span className="tnum font-mono">
              {assessment.projectedCarryAssets === null ? "Not projected" : decimal(assessment.projectedCarryAssets, loan.decimals, loan.symbol)}
              {assessment.projectedSpreadBps === null ? null : <span className="text-ink-soft"> at {percentFromBps(assessment.projectedSpreadBps)}</span>}
            </span>
          </div>
        </div>
      </div>
    </Cell>
  );
}
