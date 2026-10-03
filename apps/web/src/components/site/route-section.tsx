import { Cell, Fact } from "@/components/ui/cell";
import { forkProof, marketLltvPercent, oracleFacts, routeFacts } from "@/lib/content";

/** Archived reviewed mainnet route evidence, not the signing route. */
export function RouteSection() {
  return (
    <section id="route" className="paper-grid relative bg-paper px-5 py-24 sm:px-10">
      <div className="mb-10">
        <h2 data-reveal="headline" className="type-display max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
          The reviewed mainnet route, archived.
        </h2>
        <p className="mt-4 max-w-2xl text-base text-ink-soft">This pinned fork and these market facts describe Robinhood Chain mainnet evidence. The account you can open today signs on testnet, with test tokens, a mock oracle, and an idle-only vault.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Cell meta={routeFacts.chain} data-reveal="cell">
          <div className="p-6">
            <h3 className="type-display text-poster-md text-ink">Morpho market</h3>
            <dl className="mt-4">
              <Fact label="Market id">{routeFacts.marketId}</Fact>
              <Fact label="Collateral">{routeFacts.collateral} Stock Token</Fact>
              <Fact label="Loan token">{routeFacts.loanToken}</Fact>
              <Fact label="Oracle">{routeFacts.oracle}</Fact>
              <Fact label="Morpho LLTV">{marketLltvPercent.toFixed(1)}%</Fact>
              <Fact label="Morpho oracle value">{oracleFacts.morphoValue} USDG / AAPL</Fact>
              <Fact label="Feed-only reference">{oracleFacts.feedOnlyValue} USDG / AAPL</Fact>
            </dl>
            <p className="mt-4 max-w-prose text-poster-sm text-ink-soft">
              Recorded at block {oracleFacts.observedBlock}. Morpho&apos;s oracle is
              the value used for debt capacity and liquidation. The feed-only
              reference is a divergence check, not a second multiplier. This
              market&apos;s oracle includes the Stock Token UI multiplier beyond
              the feed ratio; applying it again here would overstate collateral.
            </p>
          </div>
        </Cell>

        <Cell meta={`chain ${routeFacts.chainId}`} data-reveal="cell">
          <div className="p-6">
            <h3 className="type-display text-poster-md text-ink">Strategy vault</h3>
            <dl className="mt-4">
              <Fact label="Generation">{routeFacts.vaultGeneration}</Fact>
              <Fact label="Vault">{routeFacts.vault}</Fact>
              <Fact label="Observed at block">{routeFacts.block}</Fact>
              <Fact label="Finality">{routeFacts.finality}</Fact>
              <Fact label="Manifest sha256">{routeFacts.integrity}</Fact>
            </dl>
          </div>
        </Cell>
      </div>

      <Cell className="mt-6" meta={`Foundry fork · block ${forkProof.block}`} data-reveal="cell">
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h3 className="type-display text-poster-md text-ink">
              The lifecycle passed on a pinned fork
            </h3>
            <p className="mt-2 max-w-2xl text-poster-sm text-ink-soft">
              Supply, owner borrow-and-deploy, Guardian strategy repayment, and
              owner exit were exercised against Robinhood state at block {forkProof.block}.
              This is fork evidence, not a live account or transaction receipt.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px border border-ink bg-ink">
            <div className="bg-paper px-5 py-3">
              <dt className="type-display text-poster-sm text-ink-soft uppercase">Morpho</dt>
              <dd className="type-display text-poster-base text-signal-verified">
                {forkProof.morphoLifecycle}
              </dd>
            </div>
            <div className="bg-paper px-5 py-3">
              <dt className="type-display text-poster-sm text-ink-soft uppercase">Vault</dt>
              <dd className="type-display text-poster-base text-signal-verified">
                {forkProof.vaultLifecycle}
              </dd>
            </div>
          </dl>
        </div>
      </Cell>
    </section>
  );
}
