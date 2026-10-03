"use client";

import { useId, useState } from "react";
import { formatUnits } from "viem";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cell } from "@/components/ui/cell";
import type { BorrowGate } from "@/lib/borrow-gate";
import { activeTokens } from "@/lib/manifest";

const { collateral, loan } = activeTokens;

function GateNotice({ gate, acknowledged, onAcknowledge }: { gate: BorrowGate; acknowledged: boolean; onAcknowledge(value: boolean): void }) {
  const checkboxId = useId();
  if (gate.kind === "blocked") {
    return <p className="border-l-2 border-signal-stop pl-3 text-sm" role="note"><span className="type-display text-poster-sm text-signal-stop">Borrow closed</span><br />{gate.reason}</p>;
  }
  if (gate.kind === "open") {
    return (
      <p className="border-l-2 border-signal-verified pl-3 text-sm" role="note">
        <span className="type-display text-poster-sm text-signal-verified">Assessment healthy</span><br />
        {gate.capacityAssets === null ? "No recorded owner capacity. The onchain debt ceiling and Morpho LLTV still apply." : `Recorded owner capacity: ${formatUnits(gate.capacityAssets, loan.decimals)} ${loan.symbol}.`}
      </p>
    );
  }
  return (
    <div className="border border-signal-degraded p-3" role="group" aria-labelledby={`${checkboxId}-title`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="degraded">Degraded</Badge>
        <p id={`${checkboxId}-title`} className="type-display text-poster-sm">Sandbox exception</p>
      </div>
      <p className="mt-2 text-sm">The risk engine cannot vouch for this borrow. Its reason codes:</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Degraded reason codes">
        {gate.reasonCodes.length === 0
          ? <li className="font-mono text-xs">none recorded</li>
          : gate.reasonCodes.map((code) => <li key={code} className="border border-ink px-2 py-1 font-mono text-xs">{code}</li>)}
      </ul>
      <label htmlFor={checkboxId} className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-sm">
        <input id={checkboxId} type="checkbox" className="mt-1 size-5 shrink-0 accent-ink" checked={acknowledged} onChange={(event) => onAcknowledge(event.target.checked)} />
        <span>I accept that only the onchain debt ceiling and Morpho LLTV bound this borrow, and that a frozen account, a stale assessment, or a failed simulation still blocks it.</span>
      </label>
    </div>
  );
}

export function EntryPanel({
  blockedReason,
  busy,
  gate,
  acknowledged,
  collateralBalance,
  onAcknowledge,
  onPrepareSupply,
  onPrepareBorrow,
}: {
  blockedReason: string | null;
  busy: boolean;
  gate: BorrowGate;
  acknowledged: boolean;
  collateralBalance: bigint | null;
  onAcknowledge(value: boolean): void;
  onPrepareSupply(amount: string): void;
  onPrepareBorrow(amount: string): void;
}) {
  const [supplyAmount, setSupplyAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const locked = blockedReason !== null || busy;
  const borrowLocked = locked || gate.kind === "blocked" || (gate.kind === "acknowledge" && !acknowledged);

  return (
    <Cell index="Enter" meta="Owner signature" className="bg-paper">
      <div className="grid gap-4 p-4 sm:p-5">
        {blockedReason ? <p className="border-l-2 border-signal-degraded pl-3 text-sm" role="note">Locked: {blockedReason}</p> : null}
        <form className="grid gap-3 border border-ink p-3" onSubmit={(event) => { event.preventDefault(); onPrepareSupply(supplyAmount); }}>
          <fieldset disabled={locked} className="grid gap-3">
            <legend className="type-display text-poster-sm">1 · Supply collateral</legend>
            <p className="text-sm text-ink-soft">Morpho collateral earns nothing. It only secures debt you approve. An exact-amount approval comes first if needed.</p>
            <label className="grid gap-1 text-sm">
              <span className="flex justify-between gap-2"><span>{collateral.symbol} amount</span>{collateralBalance !== null ? <button type="button" className="min-h-6 underline underline-offset-4" onClick={() => setSupplyAmount(formatUnits(collateralBalance, collateral.decimals))}>Wallet {formatUnits(collateralBalance, collateral.decimals)}</button> : null}</span>
              <input value={supplyAmount} onChange={(event) => setSupplyAmount(event.target.value)} className="min-h-11 border border-ink bg-paper px-3 font-mono" inputMode="decimal" autoComplete="off" placeholder="0.0" />
            </label>
            <Button type="submit" variant="outline" className="w-full">Simulate supply</Button>
          </fieldset>
        </form>
        <form className="grid gap-3 border border-ink p-3" onSubmit={(event) => { event.preventDefault(); onPrepareBorrow(borrowAmount); }}>
          <fieldset disabled={locked} className="grid gap-3">
            <legend className="type-display text-poster-sm">2 · Borrow and deploy</legend>
            <p className="text-sm text-ink-soft">Every borrow needs your signature. Borrowed {loan.symbol} can only enter the fixed vault through the Crest Account. Minimum vault shares come from a simulated preview.</p>
          </fieldset>
          <GateNotice gate={gate} acknowledged={acknowledged} onAcknowledge={onAcknowledge} />
          <fieldset disabled={borrowLocked} className="grid gap-3">
            <label className="grid gap-1 text-sm">
              <span>{loan.symbol} amount</span>
              <input value={borrowAmount} onChange={(event) => setBorrowAmount(event.target.value)} className="min-h-11 border border-ink bg-paper px-3 font-mono" inputMode="decimal" autoComplete="off" placeholder="0.0" />
            </label>
            <Button type="submit" variant="flame" className="w-full">Simulate owner borrow</Button>
          </fieldset>
        </form>
      </div>
    </Cell>
  );
}
