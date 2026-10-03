"use client";

import { useEffect, useState } from "react";

import { compactAddress } from "@/components/account/format";
import type { RecordedPosition } from "@/components/account/types";
import { positionHeadline } from "@/lib/position-headline";

const ACCOUNT = "0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75";
const CALLS = [
  ["freezeBorrowing()", "Stops new borrowing"],
  ["repayFromReserve(uint256)", "Pays debt from idle funds"],
  ["repayFromStrategy(uint256)", "Pays debt from the fixed vault"],
] as const;

function isRecordedPosition(value: unknown): value is RecordedPosition {
  if (typeof value !== "object" || value === null || !("evidence" in value) || !("account" in value) || !("snapshot" in value)) return false;
  const account = value.account;
  const snapshot = value.snapshot;
  return value.evidence === "recorded"
    && typeof account === "object" && account !== null
    && "address" in account && typeof account.address === "string" && account.address.toLowerCase() === ACCOUNT.toLowerCase()
    && "chainId" in account && account.chainId === "46630"
    && "policyNonce" in account && typeof account.policyNonce === "string"
    && (snapshot === null || (
      typeof snapshot === "object" && "frozen" in snapshot && typeof snapshot.frozen === "boolean"
      && "blockNumber" in snapshot && typeof snapshot.blockNumber === "string"
      && "observedAt" in snapshot && typeof snapshot.observedAt === "string"
      && "guardian" in snapshot && typeof snapshot.guardian === "string"
    ));
}

function observedAgo(value: string, now: number): string {
  const elapsed = now - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Observation time unavailable";
  if (elapsed < 60_000) return "Observed less than a minute ago";
  if (elapsed < 120_000) return "Observed 1 minute ago";
  if (elapsed < 3_600_000) return `Observed ${Math.floor(elapsed / 60_000)} minutes ago`;
  if (elapsed < 7_200_000) return "Observed 1 hour ago";
  if (elapsed < 86_400_000) return `Observed ${Math.floor(elapsed / 3_600_000)} hours ago`;
  return `Observed ${Math.floor(elapsed / 86_400_000)} days ago`;
}

export function LiveCustosConsole() {
  const [position, setPosition] = useState<RecordedPosition | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [now, setNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/v1/accounts/${ACCOUNT}/position`, { signal: controller.signal, headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Position unavailable");
        return response.json();
      })
      .then((value: unknown) => {
        if (!isRecordedPosition(value)) throw new Error("Position unavailable");
        setPosition(value);
        setNow(Date.now());
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setPosition(null);
        setStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  const snapshot = position?.snapshot;
  const headline = position && now ? positionHeadline(position, now) : null;

  return (
    <section aria-label="Custos live account status" className="border border-ink bg-paper text-ink shadow-[9px_9px_0_0_var(--color-ink)]">
      <div className="flex items-center justify-between gap-3 border-b border-ink px-5 py-3">
        <span className="type-display text-poster-md">Custos on duty</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Live on Robinhood Chain Testnet</span>
      </div>
      <div className="p-5 sm:p-6">
        <p className="font-mono text-xs text-ink-soft">Guardian for account <span title={ACCOUNT}>{compactAddress(ACCOUNT)}</span></p>
        {status === "ready" && snapshot && headline ? (
          <div aria-live="polite" className="mt-4 border-y border-ink py-4">
            <div className="flex items-start justify-between gap-4">
              <p className="type-display text-poster-md leading-[0.95] text-ink">{headline.title}</p>
              {snapshot.frozen ? <span className="stamp-in type-display shrink-0 -rotate-3 border-2 border-signal-stop px-2.5 py-1 text-poster-sm text-signal-stop uppercase [--delay:500ms]">Frozen</span> : null}
            </div>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-soft">{headline.detail}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-ink/25 pt-4 font-mono text-xs sm:grid-cols-3">
              <div><dt className="text-ink-soft">Borrowing</dt><dd className="mt-1 font-semibold">{snapshot.frozen ? "Frozen" : "Open"}</dd></div>
              <div><dt className="text-ink-soft">Recorded block</dt><dd className="tnum mt-1">{snapshot.blockNumber}</dd></div>
              <div><dt className="text-ink-soft">Policy nonce</dt><dd className="tnum mt-1">{position.account.policyNonce}</dd></div>
              <div className="col-span-2 sm:col-span-3"><dt className="text-ink-soft">Guardian address</dt><dd className="mt-1" title={snapshot.guardian}>{compactAddress(snapshot.guardian)}</dd></div>
            </dl>
            <p className="mt-3 font-mono text-xs text-ink-soft">{observedAgo(snapshot.observedAt, now)} · {new Date(snapshot.observedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</p>
          </div>
        ) : status === "loading" ? (
          <div role="status" className="mt-4 border-y border-ink py-4">
            <p className="type-display text-poster-md text-ink-soft">Reading the account</p>
            <p className="mt-2 text-sm text-ink-soft">Fetching the latest recorded position from the Crest service.</p>
          </div>
        ) : (
          <div role="status" className="mt-4 border-y border-ink py-4">
            <p className="type-display text-poster-md">Live status unavailable right now</p>
            <p className="mt-2 text-sm text-ink-soft">Check the account page for the latest recorded position. No live state is shown here until the service responds.</p>
          </div>
        )}
        <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-ink-soft">Only these three calls</p>
        <dl className="mt-2 divide-y divide-ink/25 border-y border-ink/25">
          {CALLS.map(([call, effect]) => (
            <div key={call} className="grid gap-1 py-2.5 sm:grid-cols-[1.15fr_1fr] sm:gap-3">
              <dt className="font-mono text-[11px] font-medium break-all">{call}</dt><dd className="text-xs text-ink-soft">{effect}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-soft">Test tokens, mock oracle, idle-only vault. Only the owner can create debt.</p>
      </div>
    </section>
  );
}
