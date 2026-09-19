import { ButtonLink } from "@/components/ui/button";
import { SlopeBand } from "@/components/ui/sloped-edge";
import { evidenceDate, heroStats, routeFacts } from "@/lib/content";

/**
 * Hero: the one promotional moment on the page. Poster-scale display type on
 * the brand blue field, the four "ones" as a ruled stat strip, and a single
 * owner-true CTA. Everything below the fold is evidence, not marketing.
 */
export function Hero() {
  return (
    <section className="blue-field blue-grid relative overflow-hidden px-5 pt-14 pb-40 sm:px-10 sm:pt-20 sm:pb-48">
      <p
        data-reveal="chip"
        className="type-display mb-6 inline-flex items-center gap-3 border border-paper/70 px-3 py-2 text-poster-sm text-paper uppercase"
      >
        <span className="inline-block size-2 rounded-full bg-flame" aria-hidden />
        Robinhood Chain · verified at block {routeFacts.block} · {evidenceDate}
      </p>

      <h1
        data-reveal="lines"
        className="type-display max-w-6xl text-poster-xl text-paper sm:text-poster-2xl lg:text-poster-3xl"
      >
        <span data-line className="block">
          Keep the stock.
        </span>
        <span data-line className="block">
          Watch the debt.
        </span>
        <span data-line className="block">
          Prove everything.
        </span>
      </h1>

      <p className="mt-8 max-w-2xl text-poster-base text-paper/90 sm:text-poster-md">
        Crest keeps your exposure to one Robinhood Stock Token, borrows USDG
        through one verified Morpho market, and puts a Guardian on the account
        that can do exactly three things. All of them reduce your debt. None of
        them can spend a token.
      </p>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <ButtonLink href="#route" variant="flame" size="lg">
          Inspect the verified route
        </ButtonLink>
        <ButtonLink href="#authority" variant="outlineLight" size="lg">
          See what the Guardian can't do
        </ButtonLink>
      </div>

      <dl className="mt-16 grid max-w-4xl grid-cols-2 gap-px border border-paper/70 bg-paper/70 sm:grid-cols-4">
        {heroStats.map((stat) => (
          <div key={stat.label} className="flex flex-col bg-crest-500 px-5 py-4">
            <dt className="type-display order-2 text-poster-sm text-paper/80 uppercase">
              {stat.label}
            </dt>
            <dd className="type-display order-1 text-poster-lg text-paper">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {/* Sloped closure carrying the logo plate angle into the next section. */}
      <SlopeBand edge="bottom" fill="var(--color-paper)" className="h-20 sm:h-28" />
    </section>
  );
}
