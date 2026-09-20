import { ButtonLink } from "@/components/ui/button";
import { Marquee } from "@/components/site/marquee";
import { evidenceDate, heroStats, routeFacts } from "@/lib/content";

/**
 * Hero: the poster cover. Brand-blue field, the B&W wordmark as a giant
 * printed backdrop, headline over it, evidence chip on top, and a marquee
 * ticker closing the fold. The B&W artwork reads cleanly on blue where the
 * blue-on-blue original would vanish.
 */
export function Hero() {
  return (
    <div data-hero-field className="bg-crest-500 text-paper transition-none">
      <section className="blue-field relative overflow-hidden">
        {/* B&W wordmark backdrop, clipped by the section so it bleeds off-edge like print */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1/2 w-[135%] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.16] select-none sm:w-[110%]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-hero-mark
            alt=""
            width={1448}
            height={1086}
            src="/crest-bw-no-bg.png"
            draggable={false}
          />
        </div>

        <div data-hero-copy className="relative px-5 pt-16 pb-36 sm:px-10 sm:pt-24 sm:pb-44">
          <p
            data-reveal="chip"
            className="type-display mb-8 inline-flex items-center gap-3 border border-paper/70 px-3 py-2 text-poster-sm uppercase"
          >
            <span className="inline-block size-2 rounded-full bg-flame" aria-hidden />
            {routeFacts.chain} · verified at block {routeFacts.block} · {evidenceDate}
          </p>

          <h1
            data-reveal="lines"
            className="type-display max-w-[13ch] text-poster-xl sm:text-poster-2xl lg:text-poster-3xl"
          >
            <span data-line className="block">
              Keep the stock.
            </span>
            <span data-line className="block">
              Watch the debt.
            </span>
            <span data-line className="block text-flame">
              Prove everything.
            </span>
          </h1>

          <p className="mt-8 max-w-xl text-poster-base text-paper/90 sm:text-poster-md">
            One Robinhood Stock Token. One verified Morpho market. A Guardian
            with exactly three moves, and every one of them shrinks your debt.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <ButtonLink href="#route" variant="flame" size="lg">
              Inspect the verified route
            </ButtonLink>
            <ButtonLink href="#authority" variant="outlineLight" size="lg">
              What the Guardian can't do
            </ButtonLink>
          </div>

          <dl className="mt-16 grid max-w-3xl grid-cols-2 gap-px border border-paper/70 bg-paper/70 sm:grid-cols-4">
            {heroStats.map((stat) => (
              <div key={stat.label} className="flex flex-col bg-crest-500 px-5 py-4">
                <dt className="type-display order-2 text-poster-sm text-paper/80 uppercase">
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
