"use client";

import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Poster reveal choreography. Scope-limited, once-only, and fully gated by
 * prefers-reduced-motion: under reduce, no tween is created and content
 * simply renders.
 *
 * Hero entrance plays immediately on load (mask-wipe lines, chip drop,
 * backdrop rise). Scroll sections reveal once on entry. Nothing numeric
 * animates; no effect repeats on scroll-back.
 */
export function RevealProvider({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // Hero: playwright-style load-in. Backdrop settles, chip drops,
        // lines wipe up behind masks, buttons and stats follow.
        const heroCopy = document.querySelector("[data-hero-copy]");
        if (heroCopy) {
          const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
          tl.from("[data-hero-mark]", { yPercent: 8, autoAlpha: 0, duration: 0.9 }, 0)
            .from(
              "[data-hero-copy] [data-reveal='chip']",
              { y: -18, autoAlpha: 0, duration: 0.5 },
              0.15,
            )
            .from(
              "[data-hero-copy] [data-line]",
              { yPercent: 112, duration: 0.75, stagger: 0.1 },
              0.2,
            )
            .from(
              "[data-hero-copy] p:not([data-reveal])",
              { y: 20, autoAlpha: 0, duration: 0.5 },
              0.5,
            )
            .from(
              "[data-hero-copy] a",
              { y: 16, autoAlpha: 0, duration: 0.45, stagger: 0.08 },
              0.6,
            )
            .from(
              "[data-hero-copy] dl > div",
              { y: 24, autoAlpha: 0, duration: 0.5, stagger: 0.06 },
              0.7,
            );
        }

        // Scroll-triggered headline lines for later sections.
        gsap.utils.toArray<HTMLElement>("[data-reveal='lines']").forEach((el) => {
          if (el.closest("[data-hero-copy]")) {
            return;
          }
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
          if (el.closest("[data-hero-copy]")) {
            return;
          }
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
