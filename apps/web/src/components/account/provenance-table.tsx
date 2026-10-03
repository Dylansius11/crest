import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Cell } from "@/components/ui/cell";
import type { RecordedInput } from "./types";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = { normal: "verified", degraded: "degraded", unknown: "degraded" };

/** What each input is, what the engine uses it for, and what it is never used for. */
const INPUT: Record<string, { label: string; use: string }> = {
  "head": { label: "Chain head", use: "Pins every onchain read; a lagging head is the only sequencer signal." },
  "account": { label: "Crest Account", use: "Owner, Guardian, policy nonce, freeze, caps, floors." },
  "market": { label: "Morpho market", use: "Exact market params, totals, borrowable liquidity." },
  "position": { label: "Morpho position", use: "Collateral and accrued debt for LTV and health." },
  "oracle.marketPrice": { label: "Market oracle", use: "Drives LTV, health, capacity. Never replaced by a REST price." },
  "oracle.collateralFeed": { label: "Collateral feed", use: "Freshness and divergence check only; not a second price." },
  "oracle.loanFeed": { label: "Loan-token feed", use: "Divergence check only." },
  "vault": { label: "Vault state", use: "Asset, caps, gates, fees, liquidity adapter." },
  "strategy": { label: "Vault position", use: "Shares, quoted and withdrawable assets for repayment bounds." },
  "rates.borrow": { label: "Borrow rate", use: "Projected carry only; never debt repaid." },
  "rates.vault": { label: "Vault rate", use: "Projected carry only; never debt repaid." },
  "rates.fees": { label: "Vault fees", use: "Netted from projected carry." },
  "rates.vaultIncentives": { label: "Vault incentives", use: "Projection only; zero when unread." },
  "rates.marketIncentives": { label: "Market incentives", use: "Projection only; zero when unread." },
};

function describe(input: string) {
  if (INPUT[input]) return INPUT[input];
  if (input.startsWith("lifecycle.")) return { label: `Lifecycle: ${input.slice("lifecycle.".length)}`, use: "Advisory: may freeze or cut capacity, never raise it." };
  return { label: input, use: "Recorded input." };
}

/**
 * Evidence provenance (DESIGN-SYSTEMS 7.11): one row per input the assessment consumed, with its own status,
 * reasons, source, and block or fetch time. Inputs are never merged into a single freshness light.
 */
export function ProvenanceTable({ rows, assessedAt }: { rows: RecordedInput[]; assessedAt: string | null }) {
  return (
    <Cell index="Provenance" meta={assessedAt ? `Assessment ${assessedAt}` : "No assessment"} className="bg-paper">
      {rows.length === 0 ? <p className="p-5 text-sm text-ink-soft">No assessment input is recorded for this account yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <caption className="sr-only">Assessment inputs with status, source, and use</caption>
            <thead className="border-b border-ink">
              <tr className="type-display text-poster-sm uppercase">
                <th scope="col" className="px-4 py-3">Input</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Source and time</th>
                <th scope="col" className="px-4 py-3">Used for</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = describe(row.input);
                return (
                  <tr key={row.input} className="border-b border-dashed border-ink/25 align-top last:border-b-0">
                    <th scope="row" className="px-4 py-3 font-normal"><span className="type-display text-poster-sm">{meta.label}</span><span className="block font-mono text-[0.7rem] text-ink-soft">{row.input}</span></th>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONE[row.status] ?? "degraded"} className="px-2 py-1 text-[0.65rem]">{row.status}</Badge>
                      {row.reasons.length > 0 ? <span className="mt-1 block font-mono text-xs">{row.reasons.join(", ")}</span> : null}
                    </td>
                    <td className="max-w-[22rem] px-4 py-3 font-mono text-xs break-all">{row.source ?? "No source"}<span className="block text-ink-soft">{row.observedAt ?? "No time"}</span></td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{meta.use}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Cell>
  );
}
