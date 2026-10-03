import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { routeFacts } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="bg-crest-950 px-5 pt-20 text-paper sm:px-10 sm:pt-28">
      <div className="mx-auto max-w-[85rem]">
        <div className="border-b border-paper/50 pb-20">
          <h2 className="type-display max-w-4xl text-poster-xl leading-[0.95] sm:text-poster-2xl">Custos cannot sell your stock.<br /><span className="text-flame">Only you create the debt.</span></h2>
          <p className="mt-6 max-w-xl text-base text-paper">Look up an account or connect your wallet. Owner signing runs on Robinhood Chain Testnet with test tokens.</p>
          <ButtonLink href="/account" variant="flame" size="lg" className="mt-8 min-h-14 shadow-[6px_6px_0_0_var(--color-ink)] transition-transform duration-150 active:scale-[0.97]">Open your account</ButtonLink>
        </div>
        <div className="flex flex-col justify-between gap-8 py-10 md:flex-row md:items-end">
          <div>
            <Logo height={56} className="h-14" />
            <p className="mt-4 max-w-lg text-sm text-paper">One stock-token market, one USDG vault, one owner who creates debt. Custos can only freeze borrowing or repay the account's own debt.</p>
          </div>
          <div className="space-y-2 font-mono text-xs text-paper">
            <p>Reviewed mainnet route, archived: chain {routeFacts.chainId}, block {routeFacts.block}</p>
            <p>Robinhood Chain Testnet signing: test tokens, mock oracle, idle-only vault.</p>
            <a href="#route" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-flame focus-visible:outline-2 focus-visible:outline-paper">Read the archived route</a>
          </div>
        </div>
        <p className="border-t border-paper/50 py-5 text-xs text-paper">Demo environment. Not financial advice. Tokenized stocks carry market, custody, and protocol risk.</p>
      </div>
    </footer>
  );
}
