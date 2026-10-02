import { AuthoritySection } from "@/components/site/authority-section";
import { CarrySection } from "@/components/site/carry-section";
import { Hero } from "@/components/site/hero";
import { HowItWorksSection } from "@/components/site/how-it-works";
import { PolicyBandSection } from "@/components/site/policy-band-section";
import { QuestionsSection } from "@/components/site/questions-section";
import { RevealProvider } from "@/components/site/reveal-provider";
import { RouteSection } from "@/components/site/route-section";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { TimelineSection } from "@/components/site/timeline-section";

import { activeManifest } from "@/lib/manifest";
import { isOwnerSigningEnabled } from "@/lib/transaction-route";
/**
 * Landing composition. The page reads like a printed dossier: blue field
 * cover, evidence spread, authority spread, the band, the carry, the watch,
 * then the colophon. Section order follows the information hierarchy in
 * DESIGN-SYSTEMS.md, and every number on the page binds to the reviewed
 * mainnet deployment manifest at build time.
 */
export default function Home() {
  const sandbox = isOwnerSigningEnabled(activeManifest);
  return (
    <RevealProvider>
      <SiteHeader />
      <aside className="border-b border-ink bg-paper px-5 py-4 text-ink sm:px-10" role="status">
        <p className="mx-auto flex max-w-[85rem] flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="type-display text-poster-sm text-signal-degraded">{sandbox ? "Sandbox open" : "Sandbox closed"}</span>
          {sandbox
            ? <span>Owner signing runs on the labeled {activeManifest.network.name} sandbox ({activeManifest.network.chainId}) with test tokens and a mock oracle. The figures below are the archived, reviewed mainnet route, not your account. <a href="/account" className="underline underline-offset-4">Open the owner workspace</a>.</span>
            : <span>The figures below are the archived, reviewed mainnet route. Owner signatures are disabled.</span>}
        </p>
      </aside>
      <main>
        <Hero />
        <HowItWorksSection />
        <RouteSection />
        <AuthoritySection />
        <PolicyBandSection />
        <CarrySection />
        <TimelineSection />
        <QuestionsSection />
      </main>
      <SiteFooter />
    </RevealProvider>
  );
}
