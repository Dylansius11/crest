import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

/**
 * Poster button. Two families:
 * - solid: ink block with paper text (on blue) or flame for the owner CTA
 * - outline: 1px ink border, transparent fill, flips on hover
 *
 * The demo is read-only, so buttons render as links or disabled controls and
 * never fake a transaction.
 */

const buttonVariants = cva(
  "type-display inline-flex min-h-11 items-center justify-center gap-2 uppercase select-none " +
    "px-5 py-3 rounded-cell text-poster-sm leading-none " +
    "transition-colors duration-150 " +
    "disabled:cursor-not-allowed disabled:opacity-45",
  {
    variants: {
      variant: {
        solid: "bg-ink text-paper hover:bg-crest-900 active:bg-crest-950",
        flame: "bg-flame text-ink hover:bg-flame-press active:bg-flame-press",
        outline: "border border-current hover:bg-ink hover:text-paper active:bg-crest-950",
        paper: "border border-ink bg-paper text-ink hover:bg-crest-100 active:bg-crest-200",
      },
      size: {
        md: "",
        lg: "px-7 py-4 text-poster-base",
      },
    },
    defaultVariants: {
      variant: "solid",
      size: "md",
    },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export type ButtonLinkProps = ComponentProps<"a"> & VariantProps<typeof buttonVariants>;

export function ButtonLink({ className, variant, size, ...props }: ButtonLinkProps) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
