import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Class merge helper for the poster component kit.
 *
 * Every styled primitive composes variants through this single boundary, so
 * call sites can override any default class and tailwind-merge resolves
 * conflicts predictably.
 *
 * The poster type scale uses `text-poster-*` for font size. stock
 * tailwind-merge does not know those tokens, so it files them under the text
 * color group and silently drops a real color class from the same call
 * (`bg-flame text-ink` became `bg-flame`, inheriting paper from the hero). The
 * scale is registered here so size and color stay separate groups.
 */
export function cn(...inputs: ClassValue[]) {
  return mergeClasses(clsx(inputs));
}

const mergeClasses = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "poster-sm",
            "poster-base",
            "poster-md",
            "poster-lg",
            "poster-xl",
            "poster-2xl",
            "poster-3xl",
          ],
        },
      ],
    },
  },
});
