import { CellLabel } from "@/components/ui/cell";
import { evidenceDate, forkProof } from "@/lib/content";

/**
 * Timeline: how the Guardian behaves, as a fixed illustrative walkthrough
 * clearly labeled as such. Crest never animates debt down before a canonical
 * postcondition, so this sequence is presented as documentation, not a live
 * feed.
 */
const steps = [
  {
    time: "12:00:28",
    title: "Upper guard crossed",
    body: "LTV hit 42.4% against a 42.0% guard. The trigger fired from fresh onchain reads, not a cached estimate.",
  },
  {
    time: "12:00:31",
    title: "Borrowing frozen",
    body: "freezeBorrowing() landed first. No new debt can exist while the account is under review.",
  },
  {
    time: "12:00:34",
    title: "Liquidity refreshed",
    body: "Vault maxWithdraw read fresh at the current block. Quoted assets are not withdrawable assets; only the real number counts.",
  },
  {
    time: "12:00:36",
    title: "Strategy repayment submitted",
    body: "repayFromStrategy(250 USDG) simulated, then submitted. The Guardian chose nothing: the route is fixed and the cap is policy.",
  },
  {
    time: "12:00:40",
    title: "Debt reduced, verified",
    body: "Debt 2,000.81 to 1,750.79 USDG at block 66,386,239. The card only turns green here, on the canonical post-state.",
  },
  {
    time: "12:00:42",
    title: "Policy LTV restored",
    body: "Position back to 35.1%, inside the target band. If repayment had failed, the account would stay frozen and say so.",
  },
] as const;

export function TimelineSection() {
  return (
    <section className="relative bg-crest-950 px-5 py-24 sm:px-10" aria-label="Guardian walkthrough">
      <div className="mb-10">
        <CellLabel className="bg-paper text-ink">05 · The watch</CellLabel>
        <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-paper sm:text-poster-xl">
          Twelve seconds, start to finish.
        </h2>
        <p className="mt-4 max-w-2xl text-poster-base text-paper/80">
          A walkthrough of one intervention, from crossing to verified repay.
          Illustrative sequence; real receipts post with exact blocks. Evidence
          below is from the pinned-fork proof run of {evidenceDate}.
        </p>
      </div>

      <ol className="border-t border-paper/30">
        {steps.map((step, i) => (
          <li
            key={step.time}
            className="grid gap-2 border-b border-paper/30 py-6 md:grid-cols-[120px_80px_1fr] md:gap-6"
          >
            <span className="tnum font-mono text-poster-sm text-paper/60">{step.time}</span>
            <span className="type-display text-poster-md text-flame">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="type-display text-poster-base text-paper uppercase">{step.title}</h3>
              <p className="mt-1 max-w-2xl text-poster-sm text-paper/75">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="type-display mt-8 text-poster-sm text-paper/60 uppercase">
        Fork proof · morpho {forkProof.morphoLifecycle} · vault {forkProof.vaultLifecycle} · block{" "}
        {forkProof.block}
      </p>
    </section>
  );
}
