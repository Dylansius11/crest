"use client";

import { useRef, type ReactNode } from "react";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Policy band scrub: the LTV gauge fills with scroll.
 *
 * A progress bar sweeps from lower to the Morpho LLTV while the section is
 * pinned for a short scroll distance. Zone labels light up as the sweep
 * passes them. Geometry only: the numbers themselves never animate, and the
 * whole effect is skipped under reduced motion.
 */
export function PolicyBandGauge({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ref.current,
            start: "top top",
            end: "+=45%",
            pin: true,
            scrub: 0.5,
            anticipatePin: 1,
          },
        });

        // Sweep the gauge across the full axis width.
        tl.fromTo(
          "[data-gauge-fill]",
          { scaleX: 0 },
          { scaleX: 1, ease: "none", duration: 1 },
          0,
        );

        // Light each zone marker as the sweep crosses it.
        gsap.utils.toArray<HTMLElement>("[data-gauge-mark]").forEach((mark, i, all) => {
          tl.fromTo(
            mark,
            { autoAlpha: 0.25, y: 6 },
            { autoAlpha: 1, y: 0, duration: 0.12, ease: "power2.out" },
            0.12 + (i / all.length) * 0.85,
          );
        });

        // Danger zone blooms when the sweep reaches it.
        tl.fromTo(
          "[data-gauge-danger]",
          { opacity: 0 },
          { opacity: 1, duration: 0.15, ease: "none" },
          0.85,
        );
      });
    },
    { scope: ref },
  );

  return <div ref={ref}>{children}</div>;
}
