import { activeTokens } from "@/lib/manifest";
import { decimal, percentFromWad } from "./format";
import type { RecordedPosition, WalletState } from "./types";

const { loan } = activeTokens;

export function AccountOverview({ wallet, position, hasAccount }: {
  wallet: WalletState;
  position: RecordedPosition | null;
  hasAccount: boolean;
}) {
  const snapshot = position?.snapshot;
  const cards = [
    { label: "Account", value: hasAccount ? position?.account.status ?? "Reading record" : wallet.kind === "connected" ? "No registered account" : "Wallet not connected", context: "Owner-controlled, one market" },
    { label: "Debt", value: decimal(snapshot?.debtAssets, loan.decimals, loan.symbol), context: "Canonical position, when recorded" },
    { label: "Current LTV", value: percentFromWad(snapshot?.ltvWad), context: snapshot ? `Target ${percentFromWad(snapshot.targetLtvWad)} · Morpho health ${decimal(snapshot.morphoHealthWad, 18, "×")}` : "No recorded collateral valuation" },
    { label: "Withdrawable", value: decimal(snapshot?.withdrawableVaultAssets, loan.decimals, loan.symbol), context: snapshot ? `Quoted ${decimal(snapshot.quotedVaultAssets, loan.decimals, loan.symbol)}` : "Vault shares are not liquid assets" },
  ];
  return (
    <section aria-label="Account at a glance" className="grid gap-px border border-ink bg-ink sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => <div key={card.label} className="min-w-0 bg-paper p-5 sm:p-6">
        <p className="type-display text-poster-sm text-ink-soft">{card.label}</p>
        <p className="mt-4 break-words font-mono text-xl leading-tight tnum sm:text-2xl">{card.value}</p>
        <p className="mt-2 text-xs text-ink-soft">{card.context}</p>
      </div>)}
      <p className="sr-only">Figures come from a recorded database snapshot, not a live wallet or chain read. Missing evidence remains unavailable.</p>
    </section>
  );
}
