import { authority } from "@/lib/content";

/**
 * Guardian console: the entire Guardian API, printed as a control panel.
 *
 * Three rows, one per callable selector, each carrying the outcome it can
 * produce. It is a specimen of the contract surface, not a live control:
 * the rows are static and labeled as the full extent of Guardian authority.
 * Hovering a row lifts it with a hard poster shadow; keyboard focus gets the
 * same treatment through focus-visible.
 */
export function GuardianConsole({ className }: { className?: string }) {
  return (
    <section
      className={`rounded-card border border-ink bg-paper text-ink ${className ?? ""}`}
      aria-label="Guardian callable surface"
    >
      <div className="flex items-stretch justify-between border-b border-ink">
        <span className="type-display flex min-h-11 items-center px-4 text-poster-sm uppercase">
          Guardian surface
        </span>
        <span className="type-display flex items-center border-l border-ink px-4 text-poster-sm uppercase">
          {authority.guardian.length} of {authority.guardian.length}
        </span>
      </div>

      <ul className="p-4">
        {authority.guardian.map((selector) => (
          <li
            key={selector}
            tabIndex={0}
            className="group border-b border-dashed border-ink/25 px-3 py-3 transition-transform duration-150 last:border-b-0 hover:-translate-y-0.5 hover:bg-crest-100 hover:shadow-[4px_4px_0_0_var(--color-ink)] focus-visible:-translate-y-0.5 focus-visible:bg-crest-100 focus-visible:shadow-[4px_4px_0_0_var(--color-ink)]"
          >
            <p className="font-mono text-poster-sm break-all">{selector}</p>
            <p className="type-display mt-1 text-poster-sm text-ink-soft uppercase">
              can only reduce this account's debt
            </p>
          </li>
        ))}
      </ul>

      <div className="border-t border-ink px-4 py-3">
        <p className="text-poster-sm text-ink-soft">
          And that is the whole surface. Everything else is not callable, not
          because a policy says so, but because the contract has no path to it.
        </p>
      </div>
    </section>
  );
}
