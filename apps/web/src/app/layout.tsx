import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/**
 * Root shell. Styling is intentionally not wired here yet: the design system stylesheet and theme tokens
 * are scaffolded separately, and this layout must not invent a second styling convention in the meantime.
 */

export const metadata: Metadata = {
  title: "Crest — policy-controlled borrowing",
  description:
    "Keep exposure to one Robinhood Stock Token, borrow USDG through one verified Morpho market, and authorize a Guardian that can only freeze or reduce this account's debt.",
  icons: { icon: "/crest-logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#236ad8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
