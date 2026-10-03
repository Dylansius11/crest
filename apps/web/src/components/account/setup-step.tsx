import type { ReactNode } from "react";

export function SetupStep({ number, title, purpose, summary, current, done, details, children }: {
  number: number;
  title: string;
  purpose: string;
  summary: string;
  current: boolean;
  done: boolean;
  details: ReactNode;
  children: ReactNode;
}) {
  return <li className={`border-b border-ink ${current ? "bg-paper" : "bg-paper-soft"}`} aria-current={current ? "step" : undefined}>
    <div className="grid grid-cols-[2.5rem_1fr] gap-3 px-4 py-5 sm:gap-5 sm:px-6">
      <span aria-hidden="true" className={`grid size-9 place-items-center border border-ink font-mono text-sm ${done ? "bg-crest-600 text-paper" : current ? "bg-ink text-paper" : "bg-paper text-ink-soft"}`}>{number}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="type-display text-poster-md">{title}</h2><span className="font-mono text-xs text-ink-soft">{done ? "Done" : current ? "Current" : "Upcoming"}</span></div>
        {current ? <div className="mt-2"><p className="max-w-[65ch] text-sm leading-relaxed">{purpose}</p><details className="mt-3 text-xs text-ink-soft"><summary className="w-fit min-h-11 cursor-pointer content-center underline underline-offset-4">Details</summary><div className="grid gap-1 border-l border-ink pl-3 font-mono break-all">{details}</div></details><div className="mt-5 min-w-0">{children}</div></div> : done ? <p className="mt-1 text-sm text-ink-soft">{summary}</p> : null}
      </div>
    </div>
  </li>;
}
