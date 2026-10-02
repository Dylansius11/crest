import { GuardianConsole } from "@/components/site/guardian-console";
import { VerificationStamp } from "@/components/ui/seal";
import { policyBand, routeFacts } from "@/lib/content";

/**
 * Custos panel: the hero's centre of gravity.
 *
 * Custos is the name of the Crest Guardian, the automation the owner
 * authorizes. The panel states what it is, what it may call, and the band it
 * watches, so a first-time visitor reads the whole authority story without
 * scrolling. It carries a specimen label: the panel describes policy and the
 * callable surface, never a live position.
 */
export function CustosPanel() {
  const span = Number(policyBand.lltv);
  const at = (v: string) => `${((Number(v) / span) * 100).toFixed(1)}%`;
  const zones = [
    { label: "lower", value: policyBand.lower },
    { label: "target", value: policyBand.target },
    { label: "upper", value: policyBand.upper },
    { label: "critical", value: policyBand.critical },
  ] as const;

  return (
    <div className="relative rounded-card border border-ink bg-paper text-ink shadow-[10px_10px_0_0_#041630]">
      <div className="flex items-stretch justify-between border-b border-ink">
        <span className="type-display flex min-h-12 items-center gap-3 px-4 text-poster-base uppercase">
          <span className="inline-flex size-3 bg-crest-600" aria-hidden />
          Custos
        </span>
        <span className="type-display flex items-center border-l border-ink px-4 text-poster-sm uppercase">
          Crest Guardian
        </span>
      </div>

      <div className="p-5">
        <p className="max-w-md text-poster-sm text-ink-soft">
          When an owner configures a Crest Account, Custos can watch its
          onchain state, freeze new borrowing, and repay that account&apos;s debt
          from its own reserve or fixed vault. This panel is an authority
          specimen, not a running Guardian or a live position.
        </p>

        <div className="mt-5 border-t border-ink pt-4">
          <p className="type-display text-poster-sm text-ink-soft uppercase">
            What it watches
          </p>
          <div className="mt-3 flex h-9 w-full overflow-hidden border border-ink">
            <span
              className="flex items-center bg-crest-100 px-2"
              style={{ width: at(policyBand.critical) }}
            >
              <span className="type-display text-[0.65rem] whitespace-nowrap text-ink uppercase">
                policy band
              </span>
            </span>
            <span className="flex flex-1 items-center justify-end bg-signal-stop/20 px-2">
              <span className="type-display text-[0.65rem] whitespace-nowrap text-signal-stop uppercase">
                LLTV {policyBand.lltv}%
              </span>
            </span>
          </div>
          <div className="tnum mt-2 flex justify-between font-mono text-[0.65rem] text-ink-soft">
            {zones.map((zone) => (
              <span key={zone.label}>
                {zone.label} {zone.value}%
              </span>
            ))}
          </div>
        </div>

        <div className="mt-5 border-t border-ink pt-4">
          <p className="type-display text-poster-sm text-ink-soft uppercase">
            What it may call
          </p>
        </div>
      </div>

      <GuardianConsole className="rounded-none border-0 border-t border-ink" />

      <div className="flex items-center justify-between gap-4 border-t border-ink px-5 py-4">
        <p className="type-display text-poster-sm text-ink uppercase">
          Policy, not vibes
          <span className="mt-1 block font-sans text-[0.7rem] font-normal tracking-normal normal-case text-ink-soft">
            Illustrative configuration. Your numbers appear after setup, from
            your own account.
          </span>
        </p>
        <VerificationStamp className="size-20 shrink-0 text-ink" />
      </div>

      <p className="border-t border-ink px-5 py-3 font-mono text-[0.65rem] text-ink-soft">
        {routeFacts.chain} · market {routeFacts.marketId.slice(0, 10)}… · vault{" "}
        {routeFacts.vault.slice(0, 10)}…
      </p>
    </div>
  );
}
