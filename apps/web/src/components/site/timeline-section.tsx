import { CellLabel } from "@/components/ui/cell";
import { evidenceDate, forkProof } from "@/lib/content";

/**
 * The watch: one intervention as a bento spread. Each tile is one beat of
 * the same illustrative sequence, sized by weight rather than order, with the
 * verified outcome given the largest tile.
 *
 * Crest never animates debt down before a canonical postcondition, so the
 * green tile prints a fixed before/after and the failure path stays visible.
 */
export function TimelineSection() {
  return (
    <section className="bg-crest-950 px-5 py-24 sm:px-10" aria-label="Guardian walkthrough">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <CellLabel className="bg-paper text-ink">06 · The watch</CellLabel>
          <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-paper sm:text-poster-xl">
            An intervention, illustrated.
          </h2>
        </div>
        <p className="max-w-md text-poster-sm text-paper/75">
          This is a hypothetical sequence, not a live monitor run or a
          transaction record. The separate fork proof is dated {evidenceDate}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-px border border-paper/25 bg-paper/25 md:grid-cols-6">
        <article
          data-reveal="cell"
          className="flex flex-col justify-between bg-crest-950 p-6 md:col-span-3"
        >
          <span className="tnum font-mono text-poster-sm text-paper/60">ILLUSTRATIVE · 01</span>
          <div className="mt-6">
            <h3 className="type-display text-poster-md text-flame uppercase">
              Upper guard crossed
            </h3>
            <p className="mt-2 text-poster-sm text-paper/75">
              If a fresh onchain read places policy LTV at 42.4% against a
              42.0% upper guard, the monitor can recommend protection.
            </p>
          </div>
        </article>

        <article
          data-reveal="cell"
          className="flex flex-col justify-between bg-crest-950 p-6 md:col-span-3"
        >
          <span className="tnum font-mono text-poster-sm text-paper/60">ILLUSTRATIVE · 02</span>
          <div className="mt-6">
            <h3 className="type-display text-poster-md text-paper uppercase">Borrowing frozen</h3>
            <p className="mt-2 text-poster-sm text-paper/75">
              A confirmed freeze would prevent additional borrowing while
              the owner reviews the position.
            </p>
          </div>
        </article>

        <article data-reveal="cell" className="bg-crest-950 p-6 md:col-span-2">
          <span className="tnum font-mono text-poster-sm text-paper/60">ILLUSTRATIVE · 03</span>
          <h3 className="type-display mt-4 text-poster-base text-paper uppercase">
            Liquidity refreshed
          </h3>
          <p className="mt-2 text-poster-sm text-paper/75">
            Current withdrawal options and simulation would bound any strategy
            repayment. Quoted shares are not withdrawable assets.
          </p>
        </article>

        <article data-reveal="cell" className="bg-crest-950 p-6 md:col-span-2">
          <span className="tnum font-mono text-poster-sm text-paper/60">ILLUSTRATIVE · 04</span>
          <h3 className="type-display mt-4 text-poster-base text-paper uppercase">
            Repayment proposed
          </h3>
          <p className="mt-2 font-mono text-[0.7rem] break-all text-crest-300">
            repayFromStrategy(250_000_000)
          </p>
          <p className="mt-2 text-poster-sm text-paper/75">
            Custos could only repay the fixed account; the policy and current
            withdrawable assets must both permit the amount.
          </p>
        </article>

        <article data-reveal="cell" className="bg-crest-950 p-6 md:col-span-2">
          <span className="tnum font-mono text-poster-sm text-paper/60">ILLUSTRATIVE · 06</span>
          <h3 className="type-display mt-4 text-poster-base text-paper uppercase">
            Policy LTV rechecked
          </h3>
          <p className="mt-2 text-poster-sm text-paper/75">
            Only canonical post-state evidence could show the position back
            inside its target band.
          </p>
        </article>

        <article
          data-reveal="cell"
          className="flex flex-col justify-between gap-6 bg-paper p-6 md:col-span-4"
        >
          <div>
            <span className="tnum font-mono text-poster-sm text-ink-soft">ILLUSTRATIVE · 05</span>
            <h3 className="type-display mt-3 text-poster-md text-ink uppercase">
              Debt reduction, illustrated
            </h3>
            <p className="mt-2 max-w-md text-poster-sm text-ink-soft">
              The before-and-after numbers below are an example, not a receipt.
              An actual repayment counts only after canonical debt and floor
              checks. If the receipt succeeds without debt falling, the
              postcondition fails.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-px border border-ink bg-ink sm:grid-cols-3">
            <div className="bg-paper px-4 py-3">
              <p className="type-display text-poster-sm text-ink-soft uppercase">before</p>
              <p className="tnum font-mono text-poster-base whitespace-nowrap text-ink">2,000.81</p>
            </div>
            <div className="bg-paper px-4 py-3">
              <p className="type-display text-poster-sm text-ink-soft uppercase">after</p>
              <p className="tnum font-mono text-poster-base whitespace-nowrap text-signal-verified">1,750.79</p>
            </div>
            <div className="bg-paper px-4 py-3">
              <p className="type-display text-poster-sm text-ink-soft uppercase">reduced</p>
              <p className="tnum font-mono text-poster-base whitespace-nowrap text-ink">250.02</p>
            </div>
          </div>
        </article>

        <article
          data-reveal="cell"
          className="flex flex-col justify-center gap-3 bg-flame p-6 text-ink md:col-span-2"
        >
          <h3 className="type-display text-poster-base uppercase">If it fails</h3>
          <p className="text-poster-sm">
            A reverted repayment keeps the account frozen, publishes the reason,
            and waits for a fresh assessment. Risk never improves on paper.
          </p>
          <p className="type-display text-poster-sm uppercase">
            Fork proof · morpho {forkProof.morphoLifecycle} · vault{" "}
            {forkProof.vaultLifecycle}
          </p>
        </article>
      </div>
    </section>
  );
}
