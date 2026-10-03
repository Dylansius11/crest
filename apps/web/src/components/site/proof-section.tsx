import { testnetManifest } from "@/lib/manifest";

const EXPLORER = `${testnetManifest.network.explorerUrl}/tx/`;

const RECEIPTS = [
  {
    title: "Custos froze new borrowing",
    description: "The Guardian called freezeBorrowing() on the account. The owner did not have to sign that freeze.",
    block: "127616213",
    hash: "0x97928bd278806869575157dc7dc515c368af602b29eb33c581c71aefa86edf02",
  },
  {
    title: "Custos repaid from the vault",
    description: "After the owner tightened the policy, Current LTV was 2.80%, above the 2% upper limit. Custos repaid toward the 1% target. The funds went from the account's vault to Morpho, never through the Guardian wallet.",
    block: "127634675",
    hash: "0xe512f21cdaf7b08eb80fb5de8c8fcd9e3221e4be5bf853621c08655dd46ce90a",
  },
  {
    title: "Custos froze borrowing unattended",
    description: "The Guardian running on the VPS froze the account when the USDG feed and Robinhood stock registry could not be read. The account remains frozen on testnet.",
    block: "127691278",
    hash: "0x86daefef76289df87bb66f2e43107d8425f1575a9a56744272e53f3c3f77971d",
  },
] as const;

export function ProofSection() {
  return (
    <section id="proof" className="bg-paper px-5 py-20 text-ink sm:px-10 sm:py-28" aria-labelledby="proof-heading">
      <div className="mx-auto max-w-[85rem]">
        <h2 id="proof-heading" data-reveal="headline" className="type-display max-w-4xl text-poster-lg sm:text-poster-xl">It already happened.</h2>
        <p className="mt-4 max-w-2xl text-base text-ink-soft">These are onchain transactions on Robinhood Chain Testnet, with test tokens. The live account can change; the receipts do not.</p>
        <div data-receipts className="mt-12 grid gap-px border border-ink bg-ink lg:grid-cols-[1fr_1.5fr_1fr]">
          {RECEIPTS.map((receipt, index) => (
            <article key={receipt.hash} className={`flex flex-col bg-paper p-6 sm:p-8 ${index === 1 ? "lg:bg-crest-100" : ""}`}>
              <p className="tnum font-mono text-xs text-ink-soft">Block {receipt.block}</p>
              <h3 className="type-display mt-3 text-[clamp(1.6rem,2.2vw,2.25rem)] leading-[0.95] text-balance">{receipt.title}</h3>
              {index === 1 ? (
                <div className="my-8">
                  <p className="tnum font-mono text-[clamp(2rem,4vw,4rem)] leading-none tracking-tight text-ink">6.421094</p>
                  <p className="type-display mt-1 text-poster-md text-ink">USDG of debt repaid</p>
                  <dl className="tnum mt-5 grid grid-cols-2 gap-4 border-t border-ink/30 pt-4 font-mono text-xs sm:text-sm">
                    <div><dt>Debt before</dt><dd className="mt-1 font-semibold">10.000047 USDG</dd></div>
                    <div><dt>Debt after</dt><dd className="mt-1 font-semibold">3.578953 USDG</dd></div>
                  </dl>
                </div>
              ) : <div className="my-5 h-px bg-ink/30" aria-hidden />}
              <p className="max-w-prose flex-1 text-sm leading-relaxed text-ink-soft">{receipt.description}</p>
              <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-ink/30 pt-4 font-mono text-xs">
                <span className="tnum">Robinhood Chain Testnet</span>
                <a href={`${EXPLORER}${receipt.hash}`} target="_blank" rel="noreferrer" className="min-h-11 content-center underline underline-offset-4 transition-colors duration-150 hover:text-crest-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-[0.97]">View transaction<span className="sr-only"> at block {receipt.block}, opens in a new tab</span></a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
