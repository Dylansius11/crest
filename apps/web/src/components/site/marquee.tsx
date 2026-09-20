/**
 * Evidence marquee: a continuously scrolling strip that carries only
 * verified manifest values, printed like a stock ticker. Pure CSS animation
 * (see --animate-marquee); disabled by prefers-reduced-motion globally.
 * Duplicate list is aria-hidden so screen readers read the facts once.
 */
const FACTS = [
  "1 market",
  "1 loan token",
  "1 vault",
  "3 Guardian selectors",
  "0 Guardian degrees of freedom",
  "1 way to find out: read the receipts",
] as const;

const TONES = {
  flame: "border-y border-paper/40 bg-flame text-ink",
  ink: "border-y border-ink bg-ink text-paper",
  blue: "border-y border-ink bg-crest-600 text-paper",
} as const;

export function Marquee({
  tone = "flame",
  facts = FACTS,
  label = "Route facts ticker",
}: {
  tone?: keyof typeof TONES;
  facts?: readonly string[];
  label?: string;
}) {
  return (
    <div className={`overflow-hidden ${TONES[tone]}`} role="marquee" aria-label={label}>
      <div className="animate-marquee flex w-max items-center py-3">
        {[0, 1].map((copy) => (
          <ul key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center">
            {facts.map((fact) => (
              <li
                key={fact}
                className="type-display flex items-center gap-6 px-6 text-poster-base whitespace-nowrap uppercase"
              >
                {fact}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  aria-hidden
                  className="shrink-0"
                >
                  <path
                    d="M9 1L11.2 6.8L17 9L11.2 11.2L9 17L6.8 11.2L1 9L6.8 6.8L9 1Z"
                    fill="currentColor"
                  />
                </svg>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
