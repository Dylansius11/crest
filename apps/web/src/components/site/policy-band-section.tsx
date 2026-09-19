import { CellLabel } from "@/components/ui/cell";
import { policyBand } from "@/lib/content";

/**
 * Policy band: the LTV ladder as a horizontal poster gauge. Lower, target,
 * upper, critical, and the Morpho LLTV sit on one ruled axis so a viewer
 * reads the whole safety envelope in one glance. Pure CSS, no chart lib, no
 * animation of the numbers themselves.
 */
export function PolicyBandSection() {
  // Axis spans 0..LLTV; positions are % of that span.
  const span = Number(policyBand.lltv);
  const at = (v: string) => `${((Number(v) / span) * 100).toFixed(1)}%`;

  const marks = [
    { label: "Lower", value: policyBand.lower, tone: "text-ink-soft" },
    { label: "Target", value: policyBand.target, tone: "text-crest-600" },
    { label: "Upper guard", value: policyBand.upper, tone: "text-signal-warn" },
    { label: "Critical", value: policyBand.critical, tone: "text-signal-stop" },
  ] as const;

  return (
    <section className="bg-paper px-5 py-24 sm:px-10" aria-label="Policy band">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <CellLabel>03 · The band</CellLabel>
          <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
            Debt is watched against a band, not a cliff.
          </h2>
        </div>
        <p className="max-w-md text-poster-sm text-ink-soft">
          The Guardian freezes borrowing when the upper guard crosses, then
          repays from your own reserve and vault. Morpho's hard LLTV sits far
          above the whole policy band.
        </p>
      </div>

      <figure>
        <div className="relative h-28 border-x border-b border-ink bg-paper-soft">
          {/* policy zone up to critical */}
          <div
            className="absolute inset-y-0 left-0 bg-crest-100"
            style={{ width: at(policyBand.critical) }}
            aria-hidden
          />
          {/* critical to LLTV danger zone */}
          <div
            className="absolute inset-y-0 bg-signal-stop/15"
            style={{ left: at(policyBand.critical), right: 0 }}
            aria-hidden
          />
          {marks.map((mark) => (
            <div
              key={mark.label}
              className="absolute inset-y-0 w-px bg-ink"
              style={{ left: at(mark.value) }}
              aria-hidden
            >
              <span
                className={`type-display absolute top-2 -translate-x-1/2 text-poster-sm whitespace-nowrap ${mark.tone}`}
              >
                {mark.value}%
              </span>
            </div>
          ))}
          {/* LLTV terminal marker */}
          <div
            className="absolute inset-y-0 right-0 w-0.5 bg-signal-stop"
            aria-hidden
          />
        </div>

        <figcaption className="mt-3 flex flex-wrap justify-between gap-4">
          <span className="type-display text-poster-sm text-ink-soft uppercase">
            Lower {policyBand.lower}% · Target {policyBand.target}% · Upper {policyBand.upper}% ·
            Critical {policyBand.critical}%
          </span>
          <span className="type-display text-poster-sm text-signal-stop uppercase">
            Morpho LLTV {policyBand.lltv}%
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
