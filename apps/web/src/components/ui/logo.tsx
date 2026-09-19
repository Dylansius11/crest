import Image from "next/image";

import { cn } from "@/lib/cn";

/**
 * Crest wordmark: the supplied artwork with the sloped plate top. The image
 * already carries its own blue plate, so it drops onto blue or paper fields
 * without recoloring. Height tracks the 1448x1086 artwork at a 4:3 ratio.
 */

export function Logo({
  className,
  priority = false,
  height = 40,
}: {
  className?: string;
  priority?: boolean;
  height?: number;
}) {
  const width = Math.round(height * (1448 / 1086));
  return (
    <Image
      src="/crest-logo-no-bg.png"
      alt="Crest"
      width={width}
      height={height}
      priority={priority}
      className={cn("w-auto", className)}
    />
  );
}
