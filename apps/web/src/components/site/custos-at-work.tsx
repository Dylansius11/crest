"use client";

import { useRef, useState } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/*
 * The band is drawn on a 25% to 60% LTV scale so the four owner marks have room
 * for their labels; Morpho's 86% LLTV sits past the right edge and is named there.
 */
const STEPS = [
  { title: "The stock price falls.", body: "The stock's value drops from 1,000 to 800 USDG. Current LTV crosses the owner's 42% upper limit.", call: "No call yet", collateral: "800 USDG", debt: "350 USDG", ltv: "43.75%", marker: "51.4%" },
  { title: "New borrowing stops.", body: "Custos freezes borrowing. It cannot sell the stock or increase the debt.", call: "freezeBorrowing()", collateral: "800 USDG", debt: "350 USDG", ltv: "43.75%", marker: "51.4%" },
  { title: "Idle funds pay down debt.", body: "Custos uses 30 USDG already held in the account's reserve. Debt falls, but Current LTV is still above target.", call: "repayFromReserve(uint256)", collateral: "800 USDG", debt: "320 USDG", ltv: "40.00%", marker: "42.9%" },
  { title: "Vault funds take it further.", body: "Custos uses 40 USDG withdrawable from the fixed vault. Current LTV returns to the owner's 35% target.", call: "repayFromStrategy(uint256)", collateral: "800 USDG", debt: "280 USDG", ltv: "35.00%", marker: "28.6%" },
] as const;

const MARKS = [
  { label: "Lower", value: "30%", left: "14.3%" },
  { label: "Target", value: "35%", left: "28.6%" },
  { label: "Upper", value: "42%", left: "48.6%" },
  { label: "Critical", value: "50%", left: "71.4%" },
] as const;

function Band({ marker, ltv }: { marker: string; ltv: string }) {
  return (
    <figure aria-label={`Illustrative Current LTV ${ltv}. Lower 30%, target 35%, upper 42%, critical 50%, Morpho LLTV 86%.`}>
      <div className="relative mt-10 h-12 border border-ink bg-paper-soft">
        <div className="absolute inset-y-0 left-[14.3%] w-[34.3%] bg-crest-100" aria-hidden />
        <div className="absolute inset-y-0 left-[71.4%] right-0 bg-signal-stop/15" aria-hidden />
        {MARKS.map((mark) => <div key={mark.label} className="absolute inset-y-0 w-px bg-ink/60" style={{ left: mark.left }} aria-hidden />)}
        <div className="absolute -top-2 -bottom-2 w-1 -translate-x-1/2 bg-ink transition-[left] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none" style={{ left: marker }} aria-hidden />
      </div>
      <div className="relative mt-3 hidden h-8 font-mono text-[11px] leading-tight text-ink-soft sm:block" aria-hidden>
        {MARKS.map((mark) => <span key={mark.label} className="absolute -translate-x-1/2 text-center" style={{ left: mark.left }}>{mark.label}<br />{mark.value}</span>)}
        <span className="absolute right-0 text-right">Morpho LLTV<br />86% →</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11px] text-ink-soft sm:hidden">
        {MARKS.map((mark) => <span key={mark.label}>{mark.label} {mark.value}</span>)}
        <span>Morpho LLTV 86%</span>
      </div>
    </figure>
  );
}

export function CustosAtWork() {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const node = section.current;
      if (!node) return;
      node.dataset.enhanced = "true";
      const trigger = ScrollTrigger.create({
        trigger: node,
        start: "top top",
        end: "+=240%",
        pin: true,
        anticipatePin: 1,
        onUpdate: (self) => setActive(Math.min(3, Math.floor(self.progress * 4))),
      });
      return () => {
        trigger.kill();
        delete node.dataset.enhanced;
        setActive(0);
      };
    });
    return () => mm.revert();
  }, { scope: section });

  const current = STEPS[active] ?? STEPS[0];

  return (
    <section id="custos-at-work" ref={section} className="group bg-crest-950 px-5 py-20 text-paper sm:px-10 lg:data-[enhanced=true]:flex lg:data-[enhanced=true]:h-[100dvh] lg:data-[enhanced=true]:items-center lg:data-[enhanced=true]:py-0" aria-labelledby="custos-work-heading">
      <div className="mx-auto w-full max-w-[85rem]">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 border-b border-paper/40 pb-6">
          <h2 id="custos-work-heading" className="type-display text-poster-lg sm:text-poster-xl">One bad day, handled.</h2>
          <p className="max-w-md text-sm leading-relaxed text-paper">Illustration. These amounts show how the owner's rules could work, not a live position or a past transaction.</p>
        </div>
        <div className="mt-10 space-y-8 lg:group-data-[enhanced=true]:hidden">
          {STEPS.map((step) => (
            <article key={step.title} className="border border-paper/50 bg-paper p-5 text-ink sm:p-8">
              <h3 className="type-display text-poster-md sm:text-poster-lg">{step.title}</h3>
              <p className="mt-3 max-w-prose text-sm leading-relaxed">{step.body}</p>
              <Band marker={step.marker} ltv={step.ltv} />
              <dl className="mt-6 grid gap-3 border-t border-ink/30 pt-4 font-mono text-xs sm:grid-cols-3">
                <div><dt>Current LTV</dt><dd className="mt-1 text-lg">{step.ltv}</dd></div>
                <div><dt>Collateral value</dt><dd className="mt-1 text-lg">{step.collateral}</dd></div>
                <div><dt>Debt</dt><dd className="mt-1 text-lg">{step.debt}</dd></div>
              </dl>
              <p className="mt-5 border-t border-ink/30 pt-4 font-mono text-xs break-all">Custos call: {step.call}</p>
            </article>
          ))}
        </div>
        <div className="mt-12 hidden gap-14 lg:group-data-[enhanced=true]:grid lg:grid-cols-[0.8fr_1.2fr] lg:items-start" aria-live="off">
          <ol className="border-l border-paper/30">
            {STEPS.map((step, index) => {
              const state = index === active ? "current" : index < active ? "done" : "next";
              return (
                <li key={step.title} aria-current={state === "current" ? "step" : undefined} className={`relative py-4 pl-7 transition-opacity duration-200 ${state === "next" ? "opacity-60" : "opacity-100"}`}>
                  <span aria-hidden className={`absolute top-0 bottom-0 -left-px w-[3px] transition-colors duration-200 ${state === "current" ? "bg-flame" : "bg-transparent"}`} />
                  <p className="tnum font-mono text-xs text-paper">{index + 1} of {STEPS.length} · {step.call}</p>
                  <h3 className={`type-display mt-2 leading-[0.95] ${state === "current" ? "text-poster-md xl:text-poster-lg" : "text-2xl"}`}>{step.title}</h3>
                  {state === "current" ? <p className="mt-3 max-w-md text-base leading-relaxed text-paper">{step.body}</p> : null}
                </li>
              );
            })}
          </ol>
          <div className="border border-ink bg-paper p-8 text-ink shadow-[10px_10px_0_0_var(--color-ink)]">
            <p className="type-display text-poster-md">The owner's LTV band</p>
            <Band marker={current.marker} ltv={current.ltv} />
            <dl className="mt-10 grid grid-cols-3 gap-4 border-y border-ink/30 py-5 font-mono text-xs">
              <div><dt>Current LTV</dt><dd className="tnum mt-2 text-xl">{current.ltv}</dd></div>
              <div><dt>Collateral value</dt><dd className="tnum mt-2 text-xl">{current.collateral}</dd></div>
              <div><dt>Debt</dt><dd className="tnum mt-2 text-xl">{current.debt}</dd></div>
            </dl>
            <p className="mt-5 font-mono text-sm break-all">Custos call: {current.call}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
