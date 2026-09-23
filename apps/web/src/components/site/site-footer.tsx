import { ButtonLink } from "@/components/ui/button";
import { Cell, CellLabel } from "@/components/ui/cell";
import { Marquee } from "@/components/site/marquee";
import { Logo } from "@/components/ui/logo";
import { routeFacts } from "@/lib/content";

const CLOSING_FACTS = [
  "Verified at a block",
  "Not a projection",
  "Not a promise",
  "A receipt",
] as const;

/**
 * Footer: colophon-style close. Restates the route identity, links the
 * onchain sources, and keeps the honest-product line. No newsletter, no
 * socials, no fake links.
 */
export function SiteFooter() {
  return (
    <>
      <Marquee tone="ink" facts={CLOSING_FACTS} label="Closing ticker" />
      <footer className="paper-grid border-t border-ink bg-paper px-5 py-16 sm:px-10">
      <div className="grid gap-10 lg:grid-cols-[1fr_auto]">
        <div>
          <Logo variant="color" height={64} className="h-14 sm:h-16" />
          <p className="mt-4 max-w-md text-poster-sm text-ink-soft">
            Crest is a policy-controlled borrowing product. One account, one
            verified market, one loan token, one vault. Projected numbers are
            labeled projected; verified numbers carry a block.
          </p>
          <p className="type-display mt-6 text-poster-sm text-ink uppercase">
            {routeFacts.chain} · chain {routeFacts.chainId} · block {routeFacts.block}
          </p>
        </div>

        <Cell className="self-start" meta="read the receipts">
          <div className="flex flex-col p-2">
            <ButtonLink
              href="https://robinhoodchain.blockscout.com"
              variant="outline"
              className="justify-start border-0"
            >
              Block explorer ↗
            </ButtonLink>
            <ButtonLink
              href="https://docs.robinhood.com/chain/connecting/"
              variant="outline"
              className="justify-start border-0"
            >
              Chain docs ↗
            </ButtonLink>
            <ButtonLink href="#route" variant="outline" className="justify-start border-0">
              Route evidence
            </ButtonLink>
          </div>
        </Cell>
      </div>

      <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-ink/20 pt-6">
        <CellLabel className="bg-ink text-paper">Crest · demo build</CellLabel>
        <p className="text-poster-sm text-ink-soft">
          Demo environment. Not financial advice. Tokenized stocks carry market,
          custody, and protocol risk.
        </p>
      </div>
      </footer>
    </>
  );
}
