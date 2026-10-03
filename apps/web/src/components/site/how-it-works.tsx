const steps = [
  {
    title: "You set the terms",
    body: "One account, one Morpho market, one loan token, one vault. Caps, floors, and the LTV band are written into the account before a single token moves.",
    meta: "owner only",
  },
  {
    title: "You create the debt",
    body: "Borrowing is never automatic. You approve it, the USDG goes straight into the fixed vault, and the account records the exact route and amount it used.",
    meta: "owner only",
  },
  {
    title: "Custos holds the line",
    body: "The Guardian reads fresh onchain state, freezes new borrowing at your upper guard, then repays from idle reserve and vault liquidity. Debt falls; the position stays yours.",
    meta: "three selectors",
  },
] as const;

export function HowItWorksSection() {
  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-label="How it works">
      <div className="mb-14">
        <h2 data-reveal="headline" className="type-display max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
          Three moves. The debt is yours to create.
        </h2>
        <p className="mt-4 max-w-xl text-poster-base text-ink-soft">
          You set the rules and approve the loan. Custos can step in only to freeze or repay.
        </p>
      </div>

      <div className="relative">
        <div aria-hidden className="h-px w-full bg-ink/15">
          <div data-hiw-line className="h-px origin-left bg-ink" />
        </div>

        <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-6">
          {steps.map((step) => (
            <li key={step.title} className="relative border-t border-ink pt-5">
              <span className="font-mono text-xs text-ink-soft">{step.meta}</span>
              <h3 className="type-display mt-5 text-poster-md text-ink uppercase">{step.title}</h3>
              <p className="mt-2 max-w-sm text-poster-sm text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
