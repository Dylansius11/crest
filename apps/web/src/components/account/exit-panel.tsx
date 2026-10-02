"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { formatUnits } from "viem";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cell, Fact } from "@/components/ui/cell";
import { activeTokens } from "@/lib/manifest";
import type { RouteToken } from "@/lib/manifest";
import type { ExitAction, LiveAccountState } from "./types";

const { collateral, loan } = activeTokens;

/** Interest keeps accruing between the read and inclusion; the contract still repays at most the debt at that block. */
const REPAY_BUFFER_BPS = 10n;

type ExitOption = { label: string; token: RouteToken | null; note: string };

const OPTION: Record<ExitAction, ExitOption> = {
  "owner-repay": { label: "Repay debt", token: loan, note: `Pays Morpho debt from your wallet. "Max" adds ${Number(REPAY_BUFFER_BPS) / 100}% for interest accruing before inclusion; the contract never takes more than the debt.` },
  "withdraw-strategy": { label: "Withdraw strategy", token: loan, note: "Redeems from the fixed vault to your wallet. Only withdrawable liquidity can leave, not quoted assets." },
  "withdraw-reserve": { label: "Withdraw reserve", token: loan, note: "Moves idle loan tokens to your wallet. The policy reserve floor still applies." },
  "withdraw-collateral": { label: "Withdraw collateral", token: collateral, note: "Returns collateral to your wallet. Morpho refuses any withdrawal that would leave the debt unhealthy." },
  unfreeze: { label: "Unfreeze borrowing", token: null, note: "Owner only. Lifts a Custos or owner freeze. It creates no debt by itself." },
};
const ACTIONS: readonly ExitAction[] = ["owner-repay", "withdraw-strategy", "withdraw-reserve", "withdraw-collateral", "unfreeze"];

function amount(value: bigint | null | undefined, token: RouteToken) {
  return value === null || value === undefined ? "Unavailable" : `${formatUnits(value, token.decimals)} ${token.symbol}`;
}

export function ExitPanel({
  live,
  notice,
  blockedReason,
  busy,
  onRefresh,
  onPrepare,
}: {
  live: LiveAccountState | null;
  notice: string;
  blockedReason: string | null;
  busy: boolean;
  /** `null` when no account is selected, so there is nothing to read. */
  onRefresh: (() => void) | null;
  onPrepare(action: ExitAction, amount: string): void;
}) {
  const [action, setAction] = useState<ExitAction>("owner-repay");
  const [value, setValue] = useState("");
  const selected = OPTION[action];
  const token = selected.token;
  const maxFor: Record<Exclude<ExitAction, "unfreeze">, bigint | null> = {
    "owner-repay": live?.debtAssets == null || live.debtAssets === 0n ? null : (live.debtAssets * (10_000n + REPAY_BUFFER_BPS) + 9_999n) / 10_000n,
    "withdraw-strategy": live?.strategyAssets == null || live.withdrawableStrategyAssets == null ? null : live.strategyAssets < live.withdrawableStrategyAssets ? live.strategyAssets : live.withdrawableStrategyAssets,
    "withdraw-reserve": live?.reserveAssets ?? null,
    "withdraw-collateral": live?.collateralAssets ?? null,
  };
  const max = action === "unfreeze" ? null : maxFor[action];
  const constrained = live?.strategyAssets != null && live.withdrawableStrategyAssets != null && live.withdrawableStrategyAssets < live.strategyAssets;

  return (
    <Cell index="Exit" meta={live ? `Live · block ${live.blockNumber}` : "Live read unavailable"} className="bg-paper">
      <div className="grid gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="max-w-md text-sm text-ink-soft" role="status" aria-live="polite">{notice}</p>
          {onRefresh ? <Button type="button" variant="outline" onClick={onRefresh} disabled={busy}><RefreshCw aria-hidden className="size-4" />Read again</Button> : null}
        </div>
        <dl>
          <Fact label="Borrowing">{live?.frozen == null ? "Unavailable" : live.frozen ? <Badge tone="stop">Frozen</Badge> : <Badge tone="verified">Open</Badge>}</Fact>
          <Fact label="Morpho debt">{amount(live?.debtAssets, loan)}</Fact>
          <Fact label="Collateral">{amount(live?.collateralAssets, collateral)}</Fact>
          <Fact label="Idle reserve">{amount(live?.reserveAssets, loan)}</Fact>
          <Fact label="Strategy, quoted">{amount(live?.strategyAssets, loan)}</Fact>
          <Fact label="Strategy, withdrawable now">
            {amount(live?.withdrawableStrategyAssets, loan)}
            {constrained ? <span className="mt-1 block font-sans text-xs text-signal-warn">Below quoted assets: vault liquidity, not shares, bounds every exit.</span> : null}
          </Fact>
        </dl>
        <form className="grid gap-3 border border-ink p-3" onSubmit={(event) => { event.preventDefault(); onPrepare(action, value); }}>
          <fieldset disabled={blockedReason !== null || busy} className="grid gap-3">
            <legend className="type-display text-poster-sm">Owner exit · value returns only to your wallet</legend>
            {blockedReason ? <p className="border-l-2 border-signal-degraded pl-3 text-sm" role="note">Locked: {blockedReason}</p> : null}
            <div role="radiogroup" aria-label="Exit action" className="grid gap-px border border-ink bg-ink sm:grid-cols-2">
              {ACTIONS.filter((option) => option !== "unfreeze" || live?.frozen === true || action === "unfreeze").map((option) => (
                <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 bg-paper px-3 text-sm has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-4px]">
                  <input type="radio" name="exit-action" value={option} checked={action === option} onChange={() => { setAction(option); setValue(""); }} className="sr-only" />
                  <span className="type-display text-poster-sm">{OPTION[option].label}</span>
                </label>
              ))}
            </div>
            <p className="text-sm text-ink-soft">{selected.note}</p>
            {token ? (
              <label className="grid gap-1 text-sm">
                <span className="flex justify-between gap-2">
                  <span>{token.symbol} amount</span>
                  {max !== null && max > 0n ? <button type="button" className="min-h-6 underline underline-offset-4" onClick={() => setValue(formatUnits(max, token.decimals))}>Max {formatUnits(max, token.decimals)}</button> : null}
                </span>
                <input value={value} onChange={(event) => setValue(event.target.value)} className="min-h-11 border border-ink bg-paper px-3 font-mono" inputMode="decimal" autoComplete="off" placeholder="0.0" />
              </label>
            ) : null}
            <Button type="submit" variant="outline" className="w-full">Simulate {selected.label.toLowerCase()}</Button>
          </fieldset>
        </form>
      </div>
    </Cell>
  );
}
