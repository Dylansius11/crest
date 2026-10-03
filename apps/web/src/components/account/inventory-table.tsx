import { Check, CircleAlert, Shield, WalletCards } from "lucide-react";

import { Cell } from "@/components/ui/cell";
import { decimal } from "./format";

export type InventoryAsset = {
  address: string;
  symbol: string;
  decimals: number;
  balance: bigint | null;
  intent: "KEEP" | "PROTECT_AND_BORROW" | "EARN_STABLE" | "UNSUPPORTED";
  qualifiedIntent: "PROTECT_AND_BORROW" | "EARN_STABLE" | null;
  reason: string;
};

const intentTone = {
  KEEP: "text-ink",
  PROTECT_AND_BORROW: "text-signal-verified",
  EARN_STABLE: "text-crest-700",
  UNSUPPORTED: "text-ink-soft",
} as const;

export function InventoryTable({
  assets,
  connected,
  locked,
  onIntentChange,
}: {
  assets: readonly InventoryAsset[];
  connected: boolean;
  locked: boolean;
  onIntentChange(address: string, intent: "KEEP" | "PROTECT_AND_BORROW" | "EARN_STABLE"): void;
}) {
  return (
    <Cell index="Wallet asset intent" meta={connected ? "Wallet RPC read" : "Read only"} className="min-w-0 bg-paper">
      <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="Wallet asset inventory, scroll horizontally for route details">
        <table className="w-full min-w-[42.5rem] text-left">
          <thead className="border-b border-ink text-poster-sm type-display uppercase">
            <tr>
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3">Balance</th>
              <th className="px-4 py-3">Intent</th>
              <th className="px-4 py-3">Route / status</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.address} className="border-b border-dashed border-ink/25 last:border-b-0">
                <th scope="row" className="px-4 py-3 font-medium">
                  <span className="flex items-center gap-2">
                    {asset.intent === "PROTECT_AND_BORROW" ? <Shield aria-hidden className="size-4" /> : asset.intent === "EARN_STABLE" ? <Check aria-hidden className="size-4" /> : <WalletCards aria-hidden className="size-4" />}
                    {asset.symbol}
                  </span>
                </th>
                <td className="tnum px-4 py-3 font-mono text-poster-sm">{asset.balance === null ? (connected ? "Unavailable" : "Connect wallet") : decimal(asset.balance.toString(), asset.decimals, asset.symbol)}</td>
                <td className={`px-4 py-3 text-poster-sm type-display ${intentTone[asset.intent]}`}>
                  {asset.qualifiedIntent ? (
                    <label className="grid gap-1">
                      <span className="sr-only">Intent for {asset.symbol}</span>
                      <select className="min-h-11 border border-ink bg-paper px-2 text-xs" value={asset.intent} disabled={locked} onChange={(event) => {
                        const next = event.target.value;
                        if (next === "KEEP" || next === asset.qualifiedIntent) onIntentChange(asset.address, next);
                      }}>
                        <option value="KEEP">KEEP · do nothing</option>
                        <option value={asset.qualifiedIntent}>{asset.qualifiedIntent.replaceAll("_", " ")}</option>
                      </select>
                    </label>
                  ) : "UNSUPPORTED"}
                </td>
                <td className="px-4 py-3 text-sm text-ink-soft">
                  {asset.intent === "UNSUPPORTED" ? <CircleAlert aria-hidden className="mr-1 inline size-4 align-text-bottom" /> : null}
                  {asset.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-px border-t border-ink bg-ink sm:grid-cols-3">
        <p className="bg-paper px-4 py-3 text-sm"><strong>KEEP</strong><br />Default. Nothing moves until you select an intent and approve the matching owner transaction.</p>
        <p className="bg-paper px-4 py-3 text-sm"><strong>EARN_ASSET unavailable</strong><br />No asset-denominated route is verified in MVP.</p>
        <p className="bg-paper px-4 py-3 text-sm"><strong>UNSUPPORTED</strong><br />Other ERC-20 discovery needs an indexed source. Crest will not infer eligibility.</p>
      </div>
    </Cell>
  );
}
