import { CellLabel } from "@/components/ui/cell";
import { PolicyBandGauge } from "@/components/site/policy-band-gauge";
import { policyBand } from "@/lib/content";

/**
 * Policy band: the LTV ladder as a sticky scroll gauge. The axis spans 0 to
 * the Morpho LLTV; zone markers light as the sweep passes them and the
 * danger zone blooms past critical. Static layout holds without JS; the
 * scrub only adds emphasis.
 */
export function PolicyBandSection() {
  const span = Number(policyBand.lltv);
  const at = (v: string) => `${((Number(v) / span) * 100).toFixed(1)}%`;

  const marks = [
    { label: "Lower", value: policyBand.lower, tone: "text-ink-soft" },
    { label: "Target", value: policyBand.target, tone: "text-crest-600" },
    { label: "Upper guard", value: policyBand.upper, tone: "text-signal-warn" },
    { label: "Critical", value: policyBand.critical, tone: "text-signal-stop" },
  ] as const;

  return (
    <PolicyBandGauge>
      <section
        className="paper-grid flex min-h-[80vh] flex-col justify-center bg-paper px-5 py-24 sm:px-10"
        aria-label="Policy band"
      >
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
          <div className="relative h-32 border-x border-b border-ink bg-paper-soft">
            {/* policy zone up to critical */}
            <div
              className="absolute inset-y-0 left-0 bg-crest-100"
              style={{ width: at(policyBand.critical) }}
              aria-hidden
            />
            {/* danger zone beyond critical */}
            <div
              data-gauge-danger
              className="absolute inset-y-0 bg-signal-stop/15 opacity-100"
              style={{ left: at(policyBand.critical), right: 0 }}
              aria-hidden
            />
            {/* sweep fill: scaleX origin left, covers whole axis */}
            <div
              data-gauge-fill
              className="absolute inset-y-0 left-0 w-full origin-left bg-crest-500/25"
              aria-hidden
            />
            {marks.map((mark) => (
              <div
                key={mark.label}
                data-gauge-mark
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
            <div className="absolute inset-y-0 right-0 w-0.5 bg-signal-stop" aria-hidden />
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
    </PolicyBandGauge>
  );
}
