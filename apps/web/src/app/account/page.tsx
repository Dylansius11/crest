import { AccountWorkspace } from "@/components/account/account-workspace";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { activeManifest } from "@/lib/manifest";
import { isOwnerSigningEnabled } from "@/lib/transaction-route";

export default function AccountPage() {
  if (isOwnerSigningEnabled(activeManifest)) return <AccountWorkspace />;

  const { network, evidence, gate, market, vault } = activeManifest;
  const explorer = network.explorerUrl.replace(/\/$/, "");
  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="blue-field blue-grid border-b border-ink px-5 py-8 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <a href="/" aria-label="Crest home" className="inline-flex min-h-14 items-center"><Logo height={56} priority /></a>
          <h1 className="mt-6 type-display text-poster-lg sm:text-poster-xl">This route is read-only.</h1>
          <p className="mt-4 max-w-2xl text-base">The selected route is recorded evidence. Owner signing is unavailable here.</p>
        </div>
      </header>
      <section className="mx-auto grid max-w-4xl gap-6 px-5 py-10 sm:px-10">
        <div className="border border-ink bg-paper p-5 sm:p-8" role="status">
          <p className="type-display text-poster-md text-signal-warn">Owner transactions unavailable</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed">Owner signing opens only on a route whose trust tier and full-route gate allow it. This route records gate {gate.outcome} (market {gate.marketGate}, vault {gate.vaultGate}) at {evidence.block.finality} block {evidence.block.number}. Funding and approving a canonical canary on it is a separate owner decision.</p>
        </div>
        <dl className="grid gap-px overflow-hidden border border-ink bg-ink text-sm">
          {[
            ["Market", market.id],
            ["Vault", vault.address],
            ["Evidence block", `${evidence.block.number} · ${evidence.block.hash}`],
          ].map(([label, value]) => (
            <div key={label} className="grid gap-1 bg-paper px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className="font-mono text-xs uppercase tracking-wider text-ink-soft">{label}</dt>
              <dd className="break-all font-mono text-xs">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/" variant="solid">Read the route evidence</ButtonLink>
          <a className="inline-flex min-h-11 items-center underline underline-offset-4" href={`${explorer}/address/${vault.address}`} target="_blank" rel="noopener noreferrer">Inspect the vault ↗</a>
        </div>
      </section>
    </main>
  );
}
