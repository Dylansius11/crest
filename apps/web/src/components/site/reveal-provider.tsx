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
 * The hero runs one load timeline keyed on data-hero-item hooks (seal,
 * console, chip, lines, lead, CTAs, stats). Sections below reveal once on
 * entry through data-reveal hooks. Nothing numeric animates.
 */
export function RevealProvider({ children }: { children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const hero = document.querySelector("[data-hero-copy]");
        if (hero) {
          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from("[data-hero-item='seal']", {
              scale: 0.55,
              autoAlpha: 0,
              duration: 0.9,
              ease: "back.out(1.5)",
            })
            .from(
              "[data-hero-item='chip']",
              { y: -18, autoAlpha: 0, duration: 0.5 },
              0.05,
            )
            .from(
              "[data-hero-item='line']",
              { yPercent: 115, duration: 0.8, stagger: 0.1 },
              0.15,
            )
            .from("[data-hero-item='lead']", { y: 22, autoAlpha: 0, duration: 0.5 }, 0.5)
            .from(
              "[data-hero-item='console']",
              { x: 36, autoAlpha: 0, duration: 0.7 },
              0.55,
            )
            .from(
              "[data-hero-item='cta']",
              { y: 16, autoAlpha: 0, duration: 0.45, stagger: 0.08 },
              0.7,
            )
            .from(
              "[data-hero-item='stat']",
              { y: 24, autoAlpha: 0, duration: 0.5, stagger: 0.06 },
              0.8,
            );
        }

        // Section headline lines.
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

        // Kicker chips.
        gsap.utils.toArray<HTMLElement>("[data-reveal='chip']").forEach((el) => {
          gsap.from(el, {
            y: 14,
            autoAlpha: 0,
            duration: 0.45,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });

        // How it works: the rail draws left to right as the section scrolls.
        gsap.utils.toArray<HTMLElement>("[data-hiw-line]").forEach((el) => {
          gsap.fromTo(
            el,
            { scaleX: 0 },
            {
              scaleX: 1,
              ease: "none",
              scrollTrigger: {
                trigger: el.parentElement ?? el,
                start: "top 85%",
                end: "bottom 60%",
                scrub: 0.4,
              },
            },
          );
        });

        // Cells: one batched wave, never re-triggered.
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
