"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { TransactionPanel } from "./transaction-panel";
import type { RecordedPosition, TransactionEvidence } from "./types";

export function ReviewSheet({ account, owner, position, transaction, prepared, blockedReason, onSimulateConfiguration, onSubmitPrepared }: {
  account: string | null;
  owner: string | null;
  position: RecordedPosition | null;
  transaction: TransactionEvidence;
  prepared: boolean;
  blockedReason: string | null;
  onSimulateConfiguration(): void;
  onSubmitPrepared(): void;
}) {
  const [dismissed, setDismissed] = useState<TransactionEvidence | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const reducedMotion = useReducedMotion();
  const locked = transaction.phase === "pending" || transaction.phase === "reconciliation-failed";
  const open = (prepared || transaction.phase !== "idle") && (locked || dismissed !== transaction);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; opener.current?.focus(); };
  }, [open]);
  if (!open) return null;
  const close = () => { if (!locked) setDismissed(transaction); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !locked) { event.preventDefault(); close(); }
    if (event.key !== "Tab" || !dialog.current) return;
    const elements = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]'));
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
    <button type="button" aria-label="Close review sheet" tabIndex={-1} disabled={locked} onClick={close} className="absolute inset-0 h-full w-full bg-ink/70" />
    <motion.div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="owner-transaction-title" tabIndex={-1} initial={reducedMotion ? false : { opacity: 0.9, transform: "translateY(16px)" }} animate={{ opacity: 1, transform: "translate(0, 0)" }} transition={{ duration: reducedMotion ? 0 : 0.24, ease: [0.23, 1, 0.32, 1] }} className="absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto border-t border-ink bg-paper text-ink shadow-[6px_6px_0_0_#0a1626] focus:outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[min(100%,40rem)] sm:border-t-0 sm:border-l">
      <div className="sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-ink bg-paper px-5">
        <p className="type-display text-poster-base">Review and sign</p>
        {locked ? <span className="text-xs text-ink-soft">Awaiting reconciliation</span> : <button type="button" onClick={close} className="min-h-11 border border-ink px-4 text-sm transition-colors duration-150 hover:bg-paper-soft active:scale-[.97] focus-visible:outline-2 focus-visible:outline-crest-700">Close</button>}
      </div>
      <TransactionPanel account={account} owner={owner} position={position} transaction={transaction} blockedReason={blockedReason} onSimulateConfiguration={onSimulateConfiguration} onSubmitPrepared={onSubmitPrepared} />
    </motion.div>
  </div>;
}
