import { Cell } from "@/components/ui/cell";
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
        <h2 data-reveal="headline" className="type-display max-w-3xl text-poster-lg text-paper sm:text-poster-xl">
          Only you can borrow. Custos can only apply the brakes.
        </h2>
        <p className="mt-4 max-w-2xl text-poster-base text-paper">
          The account contract limits Custos to freezing new borrowing and repaying this account's own debt. It cannot move value to its wallet.
        </p>
      </div>

      <div className="grid items-stretch gap-6 lg:grid-cols-3">
        <Cell className="flex h-full flex-col border-ink bg-paper" data-reveal="cell">
          <div className="flex flex-1 flex-col p-6">
            <h3 className="type-display text-poster-md text-ink">Owner can</h3>
            <p className="mt-1 text-poster-sm text-ink-soft">
              The only key that creates debt.
            </p>
            <ul className="mt-4 border-t border-ink/30">
              {authority.owner.map((item) => (
                <li
                  key={item}
                  className="type-display border-b border-ink/30 py-3 text-poster-sm text-ink uppercase"
                >
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-auto pt-6 text-sm leading-relaxed text-ink-soft">Each of these needs the owner's wallet signature. Custos holds no key that can do them.</p>
          </div>
        </Cell>

        <Cell className="flex h-full flex-col border-paper bg-crest-600 text-paper" data-reveal="cell">
          <div className="flex flex-1 flex-col p-6">
            <h3 className="type-display text-poster-md text-paper">Custos can</h3>
            <p className="mt-1 text-poster-sm text-paper">Freeze or repay. Nothing more.</p>
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
            <p className="mt-auto pt-6 text-sm leading-relaxed text-paper">Each repayment is capped per action by the owner and stops at the reserve and vault floors. The funds go to Morpho for this account only.</p>
          </div>
        </Cell>

        <Cell className="flex h-full flex-col border-ink bg-flame text-ink shadow-[8px_8px_0_0_var(--color-ink)]" data-reveal="cell">
          <div className="flex-1 p-6">
            <h3 className="type-display text-poster-md">Custos cannot</h3>
            <p className="mt-1 text-poster-sm text-ink">These actions have no Custos call.</p>
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
