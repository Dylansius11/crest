import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Evidence badge. Crest never shows an unqualified checkmark: every status
 * pairs an icon, a word, and where the fact came from. Variants map to the
 * semantic states in DESIGN-SYSTEMS.md.
 */

const badgeVariants = cva(
  "type-display inline-flex items-center gap-2 rounded-cell border px-3 py-2 text-poster-sm uppercase leading-none",
  {
    variants: {
      tone: {
        neutral: "border-ink text-ink",
        onBlue: "border-paper text-paper",
        verified: "border-signal-verified text-signal-verified",
        warn: "border-signal-warn text-signal-warn",
        stop: "border-signal-stop text-signal-stop",
        degraded: "border-signal-degraded text-signal-degraded",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
