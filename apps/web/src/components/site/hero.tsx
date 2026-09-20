import { ButtonLink } from "@/components/ui/button";
import { CustosPanel } from "@/components/site/custos-panel";
import { Marquee } from "@/components/site/marquee";
import { evidenceDate, heroStats, routeFacts } from "@/lib/content";

/**
 * Hero: the poster cover, with Custos as its centre of gravity.
 *
 * Left column states the claim in three masked lines and names the Guardian.
 * Right column carries the Custos panel: what it watches, what it may call,
 * and the stamp showing the block the route evidence was observed at. A
 * ruled stat strip closes the block, and the ticker runs at the fold.
 *
 * Background texture is a hatch band and dotted grid on the brand blue:
 * enough to feel printed, quiet enough that the panel and headline dominate.
 */
export function Hero() {
  return (
    <div className="bg-crest-600 text-paper">
      <section className="blue-field blue-grid relative overflow-hidden px-5 pt-8 pb-24 sm:px-10 sm:pt-10 sm:pb-28">
        <div
          aria-hidden
          className="hatch pointer-events-none absolute inset-x-0 top-0 h-40 opacity-40"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -bottom-40 opacity-[0.13]"
        >
          <svg width="720" height="720" viewBox="0 0 720 720" fill="none">
            {[160, 240, 320, 400].map((r) => (
              <circle
                key={r}
                cx="360"
                cy="360"
                r={r}
                stroke="var(--color-paper)"
                strokeWidth="1.5"
                strokeDasharray={r === 240 ? "6 10" : undefined}
              />
            ))}
          </svg>
        </div>

        <div data-hero-copy className="relative">
          <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-6">
              <p
                data-hero-item="chip"
                className="type-display inline-flex items-center gap-3 border border-paper/70 px-3 py-2 text-poster-sm uppercase"
              >
                <span className="inline-block size-2 rounded-full bg-flame" aria-hidden />
                {routeFacts.chain} · block {routeFacts.block} · {evidenceDate}
              </p>

              <h1 className="type-display mt-7 text-[2.75rem] leading-[0.92] sm:text-poster-xl lg:text-[4.25rem] xl:text-[5rem]">
                <span className="block overflow-hidden">
                  <span data-hero-item="line" className="block">
                    Keep the stock.
                  </span>
                </span>
                <span className="block overflow-hidden">
                  <span data-hero-item="line" className="block">
                    Watch the debt.
                  </span>
                </span>
                <span className="block overflow-hidden">
                  <span data-hero-item="line" className="block">
                    <span className="inline-block bg-flame px-3 text-ink">Prove everything.</span>
                  </span>
                </span>
              </h1>

              <p data-hero-item="lead" className="mt-7 max-w-lg text-poster-base text-paper">
                Most borrowing against stock just adds a loan that quietly grows.
                Crest puts <strong className="font-semibold text-paper">Custos</strong>, a
                Guardian with three moves and no discretion, on the account. It
                freezes new debt at your guard and pays the balance down with
                your own yield, inside caps you set.
              </p>

              <div data-hero-item="cta" className="mt-9 flex flex-wrap items-center gap-4">
                <ButtonLink
                  href="#route"
                  variant="flame"
                  size="lg"
                  className="h-14 shadow-[6px_6px_0_0_var(--color-ink)] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_var(--color-ink)]"
                >
                  Inspect the verified route
                </ButtonLink>
                <ButtonLink
                  href="#authority"
                  variant="paper"
                  size="lg"
                  className="h-14 transition-colors duration-150"
                >
                  What Custos can't do
                </ButtonLink>
              </div>
            </div>

            <div data-hero-item="console" className="lg:col-span-6">
              <CustosPanel />
            </div>
          </div>

          <dl className="mt-16 grid grid-cols-2 gap-px border border-paper/70 bg-paper/70 sm:grid-cols-4">
            {heroStats.map((stat) => (
              <div
                key={stat.label}
                data-hero-item="stat"
                className="flex flex-col bg-crest-600 px-5 py-4"
              >
                <dt className="type-display order-2 text-poster-sm text-paper uppercase">
                  {stat.label}
                </dt>
                <dd className="type-display order-1 text-poster-lg text-paper">{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Marquee />
    </div>
  );
}
