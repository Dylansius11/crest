import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Technical cell: the numbered, ruled container used across the poster
 * layout. Optional index tab in the top-left corner, optional meta label in
 * the top-right. The cell frame is always 1px ink on paper or 1px paper on
 * blue; no shadows, no gradients.
 */

export function Cell({
  index,
  meta,
  className,
  children,
  ...props
}: ComponentProps<"section"> & {
  index?: string;
  meta?: ReactNode;
}) {
  return (
    <section
      className={cn("relative rounded-card border border-ink bg-paper", className)}
      {...props}
    >
      {(index ?? meta) !== undefined && (
        <div className="flex items-stretch justify-between border-b border-ink">
          <span
            className="type-display flex min-h-11 items-center px-4 text-poster-sm"
            aria-hidden={index === undefined}
          >
            {index}
          </span>
          {meta !== undefined && (
            <span className="flex items-center border-l border-ink px-4 text-poster-sm">
              {meta}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Section label chip: uppercase kicker that titles a poster region.
 * Rendered as an h2 by default; pass `as` to demote.
 */
export function CellLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "type-display inline-flex items-center bg-ink px-3 py-2 text-poster-sm text-paper",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Fact row: exact label/value pair for addresses, hashes, and amounts.
 * Values use the mono face and break so long hex never overflows.
 */
export function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-dashed border-ink/25 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6",
        className,
      )}
    >
      <dt className="type-display text-poster-sm text-ink-soft uppercase">{label}</dt>
      <dd className="tnum min-w-0 font-mono text-poster-sm break-all text-ink">{children}</dd>
    </div>
  );
}
