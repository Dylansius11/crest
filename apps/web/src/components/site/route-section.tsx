import { Badge } from "@/components/ui/badge";
import { Cell, CellLabel, Fact } from "@/components/ui/cell";
import { forkProof, routeFacts } from "@/lib/content";

/**
 * Route section: the receipt, not a pitch. Exact market id, contract names,
 * addresses, and the pinned-fork lifecycle outcome, laid out as numbered
 * technical cells on blueprint paper.
 */
export function RouteSection() {
  return (
    <section id="route" className="paper-grid relative bg-paper px-5 py-24 sm:px-10">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div>
          <CellLabel>01 · The route</CellLabel>
          <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
            One market. Pinned, forked, and proven before it ever touches your
            account.
          </h2>
        </div>
        <Badge tone="verified" data-reveal="chip">Gate passed · full route</Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Cell index="A" meta={routeFacts.chain} data-reveal="cell">
          <div className="p-6">
            <h3 className="type-display text-poster-md text-ink">Morpho market</h3>
            <dl className="mt-4">
              <Fact label="Market id">{routeFacts.marketId}</Fact>
              <Fact label="Collateral">{routeFacts.collateral} Stock Token</Fact>
              <Fact label="Loan token">{routeFacts.loanToken}</Fact>
              <Fact label="Oracle">{routeFacts.oracle}</Fact>
              <Fact label="LLTV">{(Number("625000000000000000") / 1e18) * 100}%</Fact>
            </dl>
          </div>
        </Cell>

        <Cell index="B" meta={`chain ${routeFacts.chainId}`} data-reveal="cell">
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

      <Cell
        className="mt-6"
        index="C"
        meta={`Foundry fork · block ${forkProof.block}`}
        data-reveal="cell"
      >
        <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h3 className="type-display text-poster-md text-ink">
              The lifecycle ran on a live fork before the gate opened
            </h3>
            <p className="mt-2 max-w-2xl text-poster-sm text-ink-soft">
              Supply, owner borrow-and-deploy, Guardian strategy repayment, and
              owner exit executed at Robinhood block {forkProof.block}. Both
              lifecycles had to pass. Nothing on this page describes a
              simulation of that run; it is the recorded run.
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
