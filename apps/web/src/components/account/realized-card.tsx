import { Badge } from "@/components/ui/badge";
import { Cell, Fact } from "@/components/ui/cell";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { repaymentView } from "@/lib/position-view";
import { compactAddress, decimal } from "./format";
import type { RecordedPosition } from "./types";

const { loan } = activeTokens;
const amount = (value: bigint | string | null) => decimal(value === null ? null : value.toString(), loan.decimals, loan.symbol);

/**
 * Realized repayment (DESIGN-SYSTEMS 7.6). Only a canonical event whose debt fell turns this card green; a recorded
 * event with no debt reduction reads as a failed postcondition, and an empty card says why it is empty.
 */
export function RealizedCard({ position }: { position: RecordedPosition }) {
  const view = repaymentView(position.latestRepayment, position.snapshot !== null);
  return (
    <Cell index="Realized" meta="Canonical events" className={view.kind === "verified" ? "border-signal-verified bg-paper" : "bg-paper"}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-display text-poster-sm uppercase">Latest debt reduction</p>
          {view.kind === "verified" ? <Badge tone="verified">Verified at block {view.blockNumber}</Badge> : null}
          {view.kind === "postcondition-failed" ? <Badge tone="stop">Postcondition failed</Badge> : null}
        </div>
        {view.kind === "empty" ? <p className="mt-3 text-sm text-ink-soft">{view.reason}</p> : (
          <>
            <p className="tnum mt-3 font-mono text-poster-lg">{amount(view.reduced)}</p>
            <p className="text-xs text-ink-soft">Accrued debt reduced, from the account&apos;s own fixed vault</p>
            <dl className="mt-3">
              <Fact label="Debt before">{amount(view.before)}</Fact>
              <Fact label="Debt after">{amount(view.after)}</Fact>
              <Fact label="Transaction">
                <a className="underline underline-offset-4" href={`${activeManifest.network.explorerUrl}/tx/${view.transactionHash}`} target="_blank" rel="noreferrer">{compactAddress(view.transactionHash)}</a>
              </Fact>
            </dl>
            {view.kind === "postcondition-failed" ? <p className="mt-3 border-l-2 border-signal-stop pl-3 text-sm">The receipt was recorded but debt did not fall. This is not a repayment.</p> : null}
          </>
        )}
        <dl className="mt-4 border-t border-ink pt-1">
          <Fact label="Total realized debt repaid">{position.realizedDebtRepaidAssets === null ? "None recorded" : amount(position.realizedDebtRepaidAssets)}</Fact>
        </dl>
      </div>
    </Cell>
  );
}
