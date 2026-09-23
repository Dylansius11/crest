import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * Crest wordmark: the supplied artwork with the sloped plate top.
 *
 * Two variants exist for two surfaces: `bw` is the plate-less ink mark used
 * on the blue header field where the blue-on-blue original would vanish, and
 * `color` is the original brand plate used on paper surfaces like the footer.
 * Height tracks the 1448x1086 artwork at a 4:3 ratio.
 */
const SOURCES = {
  bw: "/crest-bw-no-bg.png",
  color: "/crest-logo-no-bg.png",
} as const;

export function Logo({
  className,
  priority = false,
  height = 40,
  variant = "bw",
}: {
  className?: string;
  priority?: boolean;
  height?: number;
  variant?: keyof typeof SOURCES;
}) {
  const width = Math.round(height * (1448 / 1086));
  return (
    <Image
      src={SOURCES[variant]}
      alt="Crest"
      width={width}
      height={height}
      priority={priority}
      className={cn("w-auto", className)}
    />
  );
}
