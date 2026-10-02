import { Cell } from "@/components/ui/cell";
import { CapitalPanel } from "./capital-panel";
import { CarryPanel } from "./carry-panel";
import { GuardianStateCard } from "./guardian-state-card";
import { LtvBandPanel } from "./ltv-band-panel";
import { RealizedCard } from "./realized-card";
import type { RecordedPosition } from "./types";

/**
 * The recorded position in DESIGN-SYSTEMS section 6 order: Guardian state and next action, the LTV band, then
 * capital, projected carry, and realized repayment as three separate facts. Nothing renders as a number until a
 * canonical same-block snapshot exists.
 */
export function PositionSection({ position, positionNotice, nowMs }: { position: RecordedPosition | null; positionNotice: string; nowMs: number }) {
  return (
    <section id="position" aria-labelledby="position-title" className="scroll-mt-6 space-y-4">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
        <div><p className="type-display text-poster-sm text-ink-soft">02 / Recorded position</p><h2 id="position-title" className="type-display text-poster-lg">Watch the position</h2></div>
        <p className="max-w-md text-sm text-ink-soft">Block-scoped records from the monitor, not live quotes. Projected carry and realized repayment are never added together.</p>
      </div>
      {position === null || position.snapshot === null ? (
        <Cell index="No recorded position" meta="Unavailable" className="bg-paper">
          <p className="p-5 text-sm sm:p-6" role="status">{position === null ? positionNotice : "This account is registered, but the monitor has not recorded a canonical snapshot for its active policy yet. Values stay unavailable rather than zero."}</p>
        </Cell>
      ) : (
        <>
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <GuardianStateCard position={position} nowMs={nowMs} />
            <LtvBandPanel position={position} />
          </div>
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-3">
            <CapitalPanel position={position} />
            <CarryPanel position={position} />
            <RealizedCard position={position} />
          </div>
        </>
      )}
    </section>
  );
}
