import { routeFacts } from "@/lib/content";

/**
 * Verification stamp: a small rotating seal carrying the exact block the
 * route evidence was observed at. Circular text is real text on an SVG arc,
 * so it stays screen-readable; the rotation is CSS-driven and stops under
 * prefers-reduced-motion. Used inside panels where it blends with the
 * surrounding frame instead of floating alone.
 */
export function VerificationStamp({ className }: { className?: string }) {
  const ring = `VERIFIED AT BLOCK ${routeFacts.block} · ${routeFacts.finality.toUpperCase()} · `;
  return (
    <span className={`relative inline-block ${className ?? ""}`}>
      <span className="sr-only">
        Verified at {routeFacts.chain} block {routeFacts.block}, {routeFacts.finality}.
      </span>
      <svg
        viewBox="0 0 200 200"
        aria-hidden
        className="size-full animate-[spin_30s_linear_infinite] motion-reduce:animate-none"
      >
        <circle
          cx="100"
          cy="100"
          r="96"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <circle
          cx="100"
          cy="100"
          r="62"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 7"
          opacity="0.6"
        />
        <defs>
          <path id="crest-stamp-arc" d="M100,100 m-80,0 a80,80 0 1,1 160,0 a80,80 0 1,1 -160,0" />
        </defs>
        <text
          fill="currentColor"
          fontSize="16"
          fontWeight="800"
          letterSpacing="1.4"
          style={{ fontFamily: "var(--font-display)", textTransform: "uppercase" }}
        >
          <textPath href="#crest-stamp-arc">{ring.repeat(2)}</textPath>
        </text>
      </svg>
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path
            d="M9 1L11.2 6.8L17 9L11.2 11.2L9 17L6.8 11.2L1 9L6.8 6.8L9 1Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </span>
  );
}
