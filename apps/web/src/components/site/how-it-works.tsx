import { CellLabel } from "@/components/ui/cell";

/**
 * How it works: three steps printed on a ruled rail that draws itself as the
 * reader scrolls. The steps are the actual product sequence: the owner sets
 * the terms, the owner creates the debt, Custos holds the line.
 *
 * The rail scrub and the step reveals are wired by the shared reveal
 * provider through data-hiw-line and data-reveal hooks.
 */
const steps = [
  {
    index: "01",
    title: "You set the terms",
    body: "One account, one Morpho market, one loan token, one vault. Caps, floors, and the LTV band are written into the account before a single token moves.",
    meta: "owner only",
  },
  {
    index: "02",
    title: "You create the debt",
    body: "Borrowing is never automatic. You approve it, the USDG goes straight into the fixed vault, and the account records the exact route and amount it used.",
    meta: "owner only",
  },
  {
    index: "03",
    title: "Custos holds the line",
    body: "The Guardian reads fresh onchain state, freezes new borrowing at your upper guard, then repays from idle reserve and vault liquidity. Debt falls; the position stays yours.",
    meta: "three selectors",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-label="How it works">
      <div className="mb-14 flex flex-wrap items-end justify-between gap-6">
        <div>
          <CellLabel>01 · How it works</CellLabel>
          <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
            Three moves, and only one of them belongs to Custos.
          </h2>
        </div>
        <p className="max-w-md text-poster-sm text-ink-soft">
          Custos cannot open a position, cannot choose a venue, and cannot move
          value out. It can only make this account's own debt smaller.
        </p>
      </div>

      <div className="relative">
        <div aria-hidden className="h-px w-full bg-ink/15">
          <div data-hiw-line className="h-px origin-left bg-ink" />
        </div>

        <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-6">
          {steps.map((step) => (
            <li key={step.index} data-reveal="cell" className="relative">
              <div className="flex items-baseline gap-4">
                <span className="type-display text-poster-xl text-crest-500">{step.index}</span>
                <span className="type-display border border-ink px-2 py-1 text-poster-sm text-ink uppercase">
                  {step.meta}
                </span>
              </div>
              <h3 className="type-display mt-5 text-poster-md text-ink uppercase">{step.title}</h3>
              <p className="mt-2 max-w-sm text-poster-sm text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
