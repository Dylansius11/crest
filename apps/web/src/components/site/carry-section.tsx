import { Cell, CellLabel, Fact } from "@/components/ui/cell";
import { carry } from "@/lib/content";

/**
 * Carry section: rates as a signed ledger, not a growth chart. Vault yield
 * and borrow cost on one audited basis, observed timestamps included, and
 * the honest warning that the spread is currently inverted. No projection is
 * ever rendered as a balance.
 */
export function CarrySection() {
  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-label="Carry">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <CellLabel>04 · The carry</CellLabel>
          <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
            Yield is a spread, so we print both sides.
          </h2>
        </div>
        <p className="max-w-md text-poster-sm text-ink-soft">
          Estimated, not realized. The realized section only moves when a
          repayment is verified onchain at a block.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Cell index="R" meta={`observed ${carry.observedAt}`} data-reveal="cell">
          <div className="p-6">
            <dl>
              <Fact label="Vault APY (USDG, 24h avg)">{carry.vaultApy}</Fact>
              <Fact label="Borrow APY (AAPL market, 24h avg)">{carry.borrowApy}</Fact>
              <Fact label="Estimated net spread">
                <span className={carry.netSpread.startsWith("-") ? "text-signal-stop" : undefined}>
                  {carry.netSpread}
                </span>
              </Fact>
            </dl>
            <p className="mt-4 text-poster-sm text-signal-warn">
              Rates move. If the spread inverts, the Guardian tightens and no
              new borrow is recommended. Stale inputs can only restrict
              behavior, never extend it.
            </p>
          </div>
        </Cell>

        <Cell index="V" meta="canonical only" data-reveal="cell">
          <div className="p-6">
            <h3 className="type-display text-poster-md text-ink">Realized, so far</h3>
            <p className="mt-2 text-poster-sm text-ink-soft">
              Nothing yet. This account has not repaid debt, so this cell stays
              empty on purpose. When a Guardian repayment verifies, the exact
              debt before and after appears here with the receipt block.
            </p>
            <p className="type-display mt-6 border border-dashed border-ink/40 px-4 py-6 text-poster-sm text-ink-soft uppercase">
              Awaiting first verified repayment
            </p>
          </div>
        </Cell>
      </div>
    </section>
  );
}
