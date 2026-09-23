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

/**
 * Landing composition. The page reads like a printed dossier: blue field
 * cover, evidence spread, authority spread, the band, the carry, the watch,
 * then the colophon. Section order follows the information hierarchy in
 * DESIGN-SYSTEMS.md, and every number on the page binds to the reviewed
 * deployment manifest at build time.
 */
export default function Home() {
  return (
    <RevealProvider>
      <SiteHeader />
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
