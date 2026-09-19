import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Crest — policy-controlled borrowing",
  description:
    "Keep exposure to one Robinhood Stock Token, borrow USDG through one verified Morpho market, and authorize a Guardian that can only freeze or reduce this account's debt.",
  icons: { icon: "/crest-logo-no-bg.png" },
};

export const viewport: Viewport = {
  themeColor: "#006afc",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
