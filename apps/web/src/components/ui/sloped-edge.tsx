import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";

/**
 * Sloped-edge band: a full-width strip whose top or bottom edge slants
 * exactly like the logo plate silhouette. Used to close the hero and open
 * the next section so the brand angle carries through the page.
 *
 * The slope is a fixed brand geometry derived from the logo artwork: the
 * plate top drops 3.5% of width from right to left, measured 69px over
 * 1088px at the logo's native scale.
 */
export function SlopeBand({
  edge = "top",
  fill = "var(--color-paper)",
  className,
  style,
}: {
  edge?: "top" | "bottom";
  /** Fill color of the band. Defaults to paper (the section below the hero). */
  fill?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const isTop = edge === "top";
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 h-16 sm:h-24", className)}
      style={{
        [isTop ? "top" : "bottom"]: 0,
        background: fill,
        clipPath: isTop
          ? "polygon(0 0, 100% 0, 100% 0%, 0 100%)"
          : "polygon(0 100%, 100% 100%, 100% 100%, 0 0%)",
        ...style,
      }}
    />
  );
}
