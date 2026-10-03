import { Cell, Fact } from "@/components/ui/cell";
import { carry } from "@/lib/content";

/**
 * Carry section: rates as a signed ledger, not a growth chart. The spread
 * gets a full-width comparison bar so the inversion is visible as geometry:
 * vault yield on the left, borrow cost on the right, net printed beneath.
 * No projection is ever rendered as a balance.
 */
export function CarrySection() {
  const vaultShare = carry.vaultShare;

  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-label="Carry">
      <div className="mb-10">
        <h2 data-reveal="headline" className="type-display max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
          Yield has two sides.
        </h2>
        <p className="mt-4 max-w-2xl text-poster-sm text-ink-soft">
          These are archived mainnet rate observations, not a current quote. The averages use different windows, so they cannot establish today's net carry. The testnet repayment above is a realized debt reduction, not yield.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Cell meta={`archived mainnet block ${carry.blockNumber} · ${carry.observedAt}`} data-reveal="cell">
          <div className="p-6">
            {vaultShare === null ? (
              <p className="mb-6 border border-ink p-4 text-poster-sm text-ink-soft">
                Rate comparison unavailable at this evidence block.
              </p>
            ) : (
              <div className="mb-6 flex h-14 w-full overflow-hidden border border-ink" role="img" aria-label={`Recorded vault APY ${carry.vaultApy} against borrow APY ${carry.borrowApy}`}>
                <div className="flex items-center bg-crest-600 px-3" style={{ width: `${vaultShare}%` }}>
                  <span className="type-display text-poster-sm text-paper uppercase">earn {carry.vaultApy}</span>
                </div>
                <div className="flex flex-1 items-center justify-end bg-flame px-3 text-right">
                  <span className="type-display text-poster-sm text-ink uppercase">pay {carry.borrowApy}</span>
                </div>
              </div>
            )}
            <dl>
              <Fact label={`Vault APY (USDG, ${carry.vaultWindow} average)`}>{carry.vaultApy}</Fact>
              <Fact label={`Borrow APY (AAPL market, ${carry.borrowWindow} average)`}>{carry.borrowApy}</Fact>
              <Fact label="Estimated net spread">
                <span className="font-medium text-signal-stop">{carry.netSpread}</span>
              </Fact>
            </dl>
            <p className="mt-4 text-poster-sm text-signal-warn">
              Historical, unequal windows are not a trade signal. Fresh onchain
              rates, vault liquidity, and policy gates must be checked before
              any owner-approved borrow.
            </p>
          </div>
        </Cell>

        <Cell meta="testnet transaction above" data-reveal="cell">
          <div className="p-6">
            <h3 className="type-display text-poster-md text-ink">Realized debt reduction</h3>
            <p className="mt-2 text-poster-sm text-ink-soft">Custos repaid 6.421094 USDG from the fixed vault in the testnet transaction above. That is repayment, not a claim about vault yield. See your own recorded outcome on the account page.</p>
            <a href="#proof" className="mt-5 inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink">See the receipt</a>
          </div>
        </Cell>
      </div>
    </section>
  );
}
