import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Cell, Fact } from "@/components/ui/cell";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { bandView, type BandZone } from "@/lib/position-view";
import { decimal, percentFromWad } from "./format";
import type { RecordedPosition } from "./types";

const { loan } = activeTokens;

const ZONE: Record<BandZone, { label: string; tone: NonNullable<BadgeProps["tone"]>; sentence: string }> = {
  "unavailable": { label: "No valuation", tone: "degraded", sentence: "Debt is recorded but the collateral valuation is not, so the LTV is unknown rather than zero." },
  "no-debt": { label: "No debt", tone: "neutral", sentence: "No debt is recorded. Custos has nothing to repay; borrowing starts only with your signature." },
  "below-lower": { label: "Below band", tone: "neutral", sentence: "Below the lower bound. Room to target is shown below and needs your approval." },
  "in-band": { label: "In band", tone: "verified", sentence: "Inside the policy band. No Guardian action is due on LTV." },
  "above-upper": { label: "Above upper guard", tone: "warn", sentence: "Above the upper guard. Custos may freeze borrowing and repay toward target." },
  "critical": { label: "Critical", tone: "stop", sentence: "At or past critical. Custos repays within its cap; you should act." },
  "beyond-lltv": { label: "Past Morpho LLTV", tone: "stop", sentence: "At or past the Morpho liquidation threshold. Liquidation is possible." },
};

/**
 * LTV band (DESIGN-SYSTEMS 7.3): the owner's band against the Morpho LLTV terminal, with distance to target in
 * both directions. Health factors live in their own rows; they are never folded into the LTV figure.
 */
export function LtvBandPanel({ position }: { position: RecordedPosition }) {
  const snapshot = position.snapshot;
  if (snapshot === null) return null;
  const lltv = BigInt(activeManifest.market.lltv);
  const view = bandView(snapshot, lltv);
  const zone = ZONE[view.zone];
  const oracle = position.assessment?.provenance.find((row) => row.input === "oracle.marketPrice") ?? null;
  const pct = (marker: string) => view.markers.find((entry) => entry.key === marker)?.at ?? 0;
  const summary = `Current LTV ${view.ltvWad === null ? "unavailable" : percentFromWad(view.ltvWad.toString())}; ${view.markers.map((marker) => `${marker.label} ${percentFromWad(marker.wad.toString())}`).join(", ")}.`;

  return (
    <Cell index="LTV band" meta={`Block ${snapshot.blockNumber}`} className="bg-paper">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="type-display text-poster-sm text-ink-soft">Current LTV</p>
            <p className="tnum mt-1 font-mono text-poster-lg">{view.zone === "no-debt" ? "0.00%" : view.ltvWad === null ? "Unavailable" : percentFromWad(view.ltvWad.toString())}</p>
          </div>
          <Badge tone={zone.tone}>{zone.label}</Badge>
        </div>
        <p className="mt-3 max-w-prose text-sm text-ink-soft">{zone.sentence}</p>

        <div className="mt-6" role="img" aria-label={summary}>
          <div className="relative h-11 border border-ink" aria-hidden>
            <span className="absolute inset-y-0 left-0 bg-paper-soft" style={{ width: `${pct("lower")}%` }} />
            <span className="absolute inset-y-0 hatch bg-crest-100" style={{ left: `${pct("lower")}%`, width: `${pct("upper") - pct("lower")}%` }} />
            <span className="absolute inset-y-0 bg-signal-warn/15" style={{ left: `${pct("upper")}%`, width: `${pct("critical") - pct("upper")}%` }} />
            <span className="absolute inset-y-0 right-0 bg-signal-stop/15" style={{ left: `${pct("critical")}%` }} />
            {view.markers.slice(0, 4).map((marker) => (
              <span key={marker.key} className={marker.key === "target" ? "absolute inset-y-0 w-0.5 bg-crest-700" : "absolute inset-y-0 w-px bg-ink/60"} style={{ left: `${marker.at}%` }} />
            ))}
            <span className="absolute inset-y-0 right-0 w-1 bg-signal-stop" />
            {view.currentAt !== null ? (
              <span className="absolute -inset-y-2 w-1 -translate-x-1/2 bg-ink" style={{ left: `${view.currentAt}%` }}>
                <span className={`type-display absolute -top-5 text-[0.65rem] whitespace-nowrap uppercase ${view.currentAt < 8 ? "left-0" : view.currentAt > 92 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>Now</span>
              </span>
            ) : null}
          </div>
          <ol className="tnum mt-3 grid grid-cols-5 gap-1 font-mono text-[0.7rem] text-ink-soft" aria-hidden>
            {view.markers.map((marker) => (
              <li key={marker.key} className={marker.key === "lltv" ? "text-right text-signal-stop" : marker.key === "target" ? "text-crest-700" : undefined}>
                <span className="type-display block text-[0.6rem] uppercase">{marker.label}</span>
                {percentFromWad(marker.wad.toString())}
              </li>
            ))}
          </ol>
        </div>

        <dl className="mt-5 border-t border-ink pt-1">
          <Fact label="Borrow room to target">
            {view.borrowToTargetAssets === null ? "Unavailable" : `${decimal(view.borrowToTargetAssets.toString(), loan.decimals, loan.symbol)}, owner approval required`}
          </Fact>
          <Fact label="Repay to return to target">{view.repayToTargetAssets === null ? "Unavailable" : decimal(view.repayToTargetAssets.toString(), loan.decimals, loan.symbol)}</Fact>
          <Fact label="Morpho health">{snapshot.morphoHealthWad === null ? "No debt or unavailable" : decimal(snapshot.morphoHealthWad, 18, "x")}</Fact>
          <Fact label="Policy health">{(position.assessment?.policyHealthWad ?? null) === null ? "Not recorded" : decimal(position.assessment?.policyHealthWad, 18, "x")}</Fact>
          <Fact label="Oracle at source block">
            {oracle === null ? "Not recorded" : `${oracle.status}${oracle.reasons.length > 0 ? ` (${oracle.reasons.join(", ")})` : ""}, block ${oracle.blockNumber ?? "unknown"}`}
          </Fact>
        </dl>
      </div>
    </Cell>
  );
}
