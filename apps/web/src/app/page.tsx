import { AuthoritySection } from "@/components/site/authority-section";
import { CarrySection } from "@/components/site/carry-section";
import { CustosAtWork } from "@/components/site/custos-at-work";
import { Hero } from "@/components/site/hero";
import { HowItWorksSection } from "@/components/site/how-it-works";
import { PolicyBandSection } from "@/components/site/policy-band-section";
import { ProofSection } from "@/components/site/proof-section";
import { QuestionsSection } from "@/components/site/questions-section";
import { RevealProvider } from "@/components/site/reveal-provider";
import { RouteSection } from "@/components/site/route-section";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export default function Home() {
  return (
    <RevealProvider>
      <SiteHeader />
      <main>
        <Hero />
        <CustosAtWork />
        <ProofSection />
        <AuthoritySection />
        <HowItWorksSection />
        <PolicyBandSection />
        <CarrySection />
        <RouteSection />
        <QuestionsSection />
      </main>
      <SiteFooter />
    </RevealProvider>
  );
}
