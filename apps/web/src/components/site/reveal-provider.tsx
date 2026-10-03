"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function RevealProvider({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const root = scope.current;
      if (!root) return;
      // Each headline wipes up once as it enters. GSAP applies the start state
      // only after hydration, so without JavaScript every headline stays visible.
      gsap.utils.toArray<HTMLElement>("[data-reveal='headline']", root).forEach((headline) => {
        gsap.from(headline, { clipPath: "inset(0 0 100% 0)", y: 18, duration: 0.72, ease: "expo.out", scrollTrigger: { trigger: headline, start: "top 85%", once: true } });
      });
      const receiptGrid = root.querySelector("#proof [data-receipts]");
      if (receiptGrid) {
        gsap.from(receiptGrid, { clipPath: "inset(0 0 100% 0)", duration: 0.85, ease: "expo.out", scrollTrigger: { trigger: receiptGrid, start: "top 80%", once: true } });
      }
      const authority = root.querySelector("#authority");
      if (authority) {
        gsap.from(authority.querySelectorAll("[data-reveal='cell']"), { y: 24, opacity: 0, duration: 0.65, stagger: 0.1, ease: "expo.out", scrollTrigger: { trigger: authority, start: "top 70%", once: true } });
      }
      const line = root.querySelector("[data-hiw-line]");
      if (line) {
        gsap.from(line, { scaleX: 0, transformOrigin: "left center", duration: 0.75, ease: "expo.out", scrollTrigger: { trigger: line, start: "top 80%", once: true } });
      }
      const refresh = () => {
        if (!document.hidden) ScrollTrigger.refresh();
      };
      document.addEventListener("visibilitychange", refresh);
      window.addEventListener("load", refresh);
      return () => {
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("load", refresh);
      };
    });
    return () => mm.revert();
  }, { scope });

  return <div ref={scope} className="contents">{children}</div>;
}
