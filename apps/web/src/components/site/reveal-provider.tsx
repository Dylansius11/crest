"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Poster reveal choreography. Scope-limited, once-only, and fully gated by
 * prefers-reduced-motion: under reduce, no tween is created and content
 * simply renders. The choreography matches the dossier character: headline
 * lines wipe up, cells settle in one wave, kickers snap. Nothing numeric
 * animates; no effect repeats on scroll-back.
 */
export function RevealProvider({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Headline lines: quick upward wipe, once.
        gsap.utils.toArray<HTMLElement>("[data-reveal='lines']").forEach((el) => {
          const lines = el.querySelectorAll("[data-line]");
          gsap.from(lines, {
            yPercent: 110,
            duration: 0.7,
            ease: "power3.out",
            stagger: 0.09,
            scrollTrigger: { trigger: el, start: "top 80%", once: true },
          });
        });

        // Kicker chips: small settle.
        gsap.utils.toArray<HTMLElement>("[data-reveal='chip']").forEach((el) => {
          gsap.from(el, {
            y: 14,
            autoAlpha: 0,
            duration: 0.45,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });

        // Cells: batch entrance, one wave, never re-triggered.
        ScrollTrigger.batch("[data-reveal='cell']", {
          start: "top 85%",
          once: true,
          onEnter: (batch) =>
            gsap.from(batch, {
              y: 28,
              autoAlpha: 0,
              duration: 0.55,
              ease: "power2.out",
              stagger: 0.08,
              overwrite: true,
            }),
        });
      });
    },
    { scope },
  );

  // The wrapper renders nothing itself; it only owns the GSAP scope.
  return <div ref={scope} className="contents">{children}</div>;
}
