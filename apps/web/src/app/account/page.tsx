import { AccountWorkspace } from "@/components/account/account-workspace";
import { reviewedManifest } from "@/lib/manifest";
import { isTestnetRouteQualified } from "@/lib/transaction-route";

export default function AccountPage() {
  if (isTestnetRouteQualified(reviewedManifest)) return <AccountWorkspace />;

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="blue-field blue-grid border-b border-ink px-5 py-8 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <p className="type-display text-poster-base">Crest / Owner workspace</p>
          <p className="mt-6 font-mono text-sm uppercase tracking-wider">Robinhood Chain Testnet · chain 46630</p>
          <h1 className="mt-3 type-display text-poster-lg sm:text-poster-xl">A route on a fork. Not a live account.</h1>
          <p className="mt-4 max-w-2xl text-base">A TSLA-labeled / USDG candidate completes the Crest lifecycle on a pinned testnet fork. It is not qualified for an owner signature.</p>
        </div>
      </header>
      <section className="mx-auto grid max-w-4xl gap-6 px-5 py-10 sm:px-10">
        <div className="border border-ink bg-paper p-5 sm:p-8" role="status">
          <p className="type-display text-poster-sm text-signal-warn">Experimental / transactions unavailable</p>
          <h2 className="mt-3 type-display text-poster-base">Fork evidence is not a live receipt</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed">At finalized testnet block 127234001, a local fork funded a disposable owner with test collateral, borrowed 0.1 test USDG, deposited it into the fixed vault, repaid 0.05 test USDG from the vault via Guardian, and closed the position. No Crest Account was deployed on testnet or signed by your wallet. The test USDG has no monetary value.</p>
          <p className="mt-4 max-w-2xl border-l-2 border-signal-stop pl-3 text-sm leading-relaxed">The official Stock Token registry currently lists no testnet deployments, including this TSLA-labeled address. The market oracle source and independent price feeds are unverified; the vault allocates into a mock-collateral market. These are blockers, not small-print risks. No APY, safe stock price, or available wallet balance is inferred.</p>
        </div>
        <div className="border border-ink bg-paper p-5 sm:p-8">
          <p className="type-display text-poster-sm text-ink-soft">Candidate / observed at one block</p>
          <h2 className="mt-2 type-display text-poster-base">One fixed Morpho route</h2>
          <dl className="mt-5 grid gap-px overflow-hidden border border-ink bg-ink text-sm">
            {[
              ["Network", "Robinhood Chain Testnet · 46630"],
              ["Market liquidity", "1 test USDG free at the observed block · shared, not reserved"],
              ["Vault liquidity", "Withdraw tested on a fork · not a current exit quote"],
              ["Source", "Finalized block 127234001 · 2026-10-01 17:19:22 UTC"],
            ].map(([label, value]) => (
              <div key={label} className="grid gap-1 bg-paper px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
                <dt className="font-mono text-xs uppercase tracking-wider text-ink-soft">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-3 text-sm">
            <a className="min-h-11 py-2 underline underline-offset-4" href="https://explorer.testnet.chain.robinhood.com/address/0x2275d8C96E52C3368E062aA04F41578E9bFb99d3" target="_blank" rel="noopener noreferrer">Inspect Morpho core ↗</a>
            <a className="min-h-11 py-2 underline underline-offset-4" href="https://explorer.testnet.chain.robinhood.com/address/0xA630E3995B74C9Dc50Bf05eF6bbBD1D7C67b9D41" target="_blank" rel="noopener noreferrer">Inspect USDG vault ↗</a>
            <a className="min-h-11 py-2 underline underline-offset-4" href="https://explorer.testnet.chain.robinhood.com/address/0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" target="_blank" rel="noopener noreferrer">Inspect TSLA-labeled token ↗</a>
          </div>
          <p className="mt-4 break-all font-mono text-xs text-ink-soft">Market ID: 0xa5b036cccef6ef2079619c6c438aec1a223f451ef17b2304de2dd262c637d80d</p>
        </div>
        <p className="text-sm leading-relaxed">Next gate: independently establish token provenance and price-feed trust, recheck current market and withdrawable vault liquidity, then migrate every chain-bound service together. The <a className="underline underline-offset-4" href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noopener noreferrer">testnet faucet</a> provides gas, not collateral or a qualified borrowing route.</p>
      </section>
    </main>
  );
}
