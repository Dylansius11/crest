import { policyBand } from "@/lib/content";

const marks = [
  { label: "Lower LTV", value: policyBand.lower },
  { label: "Target LTV", value: policyBand.target },
  { label: "Upper LTV", value: policyBand.upper },
  { label: "Critical LTV", value: policyBand.critical },
] as const;

export function PolicyBandSection() {
  const at = (value: string) => `${(Number(value) / Number(policyBand.lltv)) * 100}%`;
  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-labelledby="policy-heading">
      <div className="mx-auto max-w-[85rem]">
        <h2 id="policy-heading" data-reveal="headline" className="type-display max-w-3xl text-poster-lg text-ink sm:text-poster-xl">The owner draws the lines.</h2>
        <p className="mt-4 max-w-2xl text-base text-ink-soft">Example owner limits, not the live testnet account's policy. Morpho LLTV belongs to the archived mainnet market and is the protocol limit, not the owner's target.</p>
        <figure className="mt-14 border-t border-ink pt-10">
          <div className="relative h-28 border border-ink bg-paper-soft">
            <div className="absolute inset-y-0 left-0 bg-crest-100" style={{ width: at(policyBand.critical) }} aria-hidden />
            <div className="absolute inset-y-0 right-0 bg-signal-stop/15" style={{ left: at(policyBand.critical) }} aria-hidden />
            {marks.map((mark) => <span key={mark.label} className="absolute inset-y-0 w-px bg-ink" style={{ left: at(mark.value) }} aria-hidden />)}
          </div>
          <figcaption className="mt-6 grid grid-cols-2 gap-px border border-ink bg-ink sm:grid-cols-5">
            {marks.map((mark) => <div key={mark.label} className="bg-paper p-4"><span className="block text-sm text-ink-soft">{mark.label}</span><span className="tnum mt-1 block font-mono text-xl text-ink">{mark.value}%</span></div>)}
            <div className="bg-paper p-4"><span className="block text-sm text-ink-soft">Morpho LLTV</span><span className="tnum mt-1 block font-mono text-xl text-signal-stop">{policyBand.lltv}%</span></div>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
