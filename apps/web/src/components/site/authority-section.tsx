import { Cell, CellLabel } from "@/components/ui/cell";
import { authority } from "@/lib/content";

/**
 * Authority section: the permission inspector as a poster spread.
 *
 * All three cells share one grid track stack so their frames line up exactly.
 * The Guardian-cannot cell carries the flame plate and hard ink shadow: it is
 * the product statement, but it is sized like its siblings, not oversized.
 */
export function AuthoritySection() {
  return (
    <section id="authority" className="relative bg-crest-950 px-5 py-24 sm:px-10">
      <div className="mb-10">
        <CellLabel className="bg-paper text-ink">02 · Authority</CellLabel>
        <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-paper sm:text-poster-xl">
          The Guardian can shrink your debt. It cannot do anything else.
        </h2>
        <p className="mt-4 max-w-2xl text-poster-base text-paper/80">
          Authority is enforced by the account contract, not by a promise. The
          Guardian holds three selectors and every one of them can only move
          this account's own debt down.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Cell
          className="flex flex-col border-paper bg-transparent"
          index="O"
          meta="You"
          headerTone="paper"
          data-reveal="cell"
        >
          <div className="flex-1 p-6">
            <h3 className="type-display text-poster-md text-paper">Owner</h3>
            <p className="mt-1 text-poster-sm text-paper/70">The only key that creates debt.</p>
            <ul className="mt-4 border-t border-paper/40">
              {authority.owner.map((item) => (
                <li
                  key={item}
                  className="type-display border-b border-paper/40 py-3 text-poster-sm text-paper uppercase"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Cell>

        <Cell
          className="flex flex-col border-paper bg-crest-500"
          index="G"
          meta="Three selectors"
          headerTone="paper"
          data-reveal="cell"
        >
          <div className="flex-1 p-6">
            <h3 className="type-display text-poster-md text-paper">Guardian</h3>
            <p className="mt-1 text-poster-sm text-paper/80">Freeze or repay. Nothing more.</p>
            <ul className="mt-4 border-t border-paper/40">
              {authority.guardian.map((selector) => (
                <li
                  key={selector}
                  className="border-b border-paper/40 py-3 font-mono text-poster-sm break-all text-paper"
                >
                  {selector}
                </li>
              ))}
            </ul>
          </div>
        </Cell>

        <Cell
          className="flex flex-col border-ink bg-flame text-ink shadow-[8px_8px_0_0_#0a1626]"
          index="X"
          meta="Never"
          data-reveal="cell"
        >
          <div className="flex-1 p-6">
            <h3 className="type-display text-poster-md">Guardian cannot</h3>
            <p className="mt-1 text-poster-sm text-ink/80">
              Read this list twice. It is the product.
            </p>
            <ul className="mt-4 border-t border-ink">
              {authority.guardianCannot.map((item) => (
                <li
                  key={item}
                  className="type-display flex items-center justify-between gap-3 border-b border-ink py-3 text-poster-sm uppercase"
                >
                  <span className="line-through decoration-ink/60 decoration-2">{item}</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                    className="shrink-0 opacity-70"
                  >
                    <path
                      d="M2 2L14 14M14 2L2 14"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="square"
                    />
                  </svg>
                </li>
              ))}
            </ul>
          </div>
        </Cell>
      </div>
    </section>
  );
}
