import { Cell, CellLabel } from "@/components/ui/cell";
import { authority } from "@/lib/content";

/**
 * Authority section: the permission inspector as a poster spread. Owner and
 * Guardian columns are visually unequal on purpose. The red column lists
 * what the Guardian can never do; it is the longest list and that is the
 * product.
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
        <Cell className="border-paper bg-transparent" index="O" meta="You" data-reveal="cell">
          <div className="p-6">
            <h3 className="type-display text-poster-md text-paper">Owner</h3>
            <p className="mt-1 text-poster-sm text-paper/70">The only key that creates debt.</p>
            <ul className="mt-4 space-y-0 border-t border-paper/40">
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
          className="border-paper bg-crest-500"
          index="G"
          meta="Three selectors"
          data-reveal="cell"
        >
          <div className="p-6">
            <h3 className="type-display text-poster-md text-paper">Guardian</h3>
            <p className="mt-1 text-poster-sm text-paper/80">Freeze or repay. Nothing more.</p>
            <ul className="mt-4 space-y-0 border-t border-paper/40">
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
          className="border-signal-stop bg-transparent"
          index="X"
          meta="Never"
          data-reveal="cell"
        >
          <div className="p-6">
            <h3 className="type-display text-poster-md text-signal-stop">Guardian cannot</h3>
            <p className="mt-1 text-poster-sm text-paper/70">
              Read this list twice. It is the product.
            </p>
            <ul className="mt-4 space-y-0 border-t border-signal-stop/60">
              {authority.guardianCannot.map((item) => (
                <li
                  key={item}
                  className="type-display border-b border-signal-stop/60 py-3 text-poster-sm text-signal-stop uppercase"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Cell>
      </div>
    </section>
  );
}
