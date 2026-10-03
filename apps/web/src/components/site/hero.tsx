import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { LiveCustosConsole } from "@/components/site/live-custos-console";

/**
 * The cover. The claim on the left, Custos itself on the right: a live duty card
 * read from the demo account, so the first viewport proves the Guardian runs
 * instead of describing it. The receipt line under the CTAs points at the one
 * repayment Custos already made on testnet.
 */
export function Hero() {
  return (
    <section className="blue-field blue-grid relative overflow-hidden px-5 pt-10 pb-20 text-paper sm:px-10 sm:pt-14 sm:pb-28" aria-labelledby="hero-heading">
      <div aria-hidden className="hatch pointer-events-none absolute inset-x-0 top-0 h-28 opacity-30" />
      <div className="relative mx-auto grid max-w-[85rem] items-center gap-12 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)] lg:gap-14">
        <div className="min-w-0">
          <h1 id="hero-heading" className="type-display text-[clamp(2.75rem,5.3vw,5.25rem)] leading-[0.9] tracking-[-0.03em] text-balance">
            <span className="rise-in block">Borrow against your stock.</span>
            <span className="rise-in mt-2 block [--delay:110ms]">
              <span className="bg-flame px-2 text-ink [box-decoration-break:clone]">Custos</span> guards the debt.
            </span>
          </h1>
          <p className="rise-in mt-8 max-w-xl text-lg leading-relaxed text-paper [--delay:220ms] sm:text-xl">
            You set the limits. Custos can only freeze new borrowing or pay your debt down. It can never borrow, move, or sell.
          </p>
          <div className="rise-in mt-10 flex flex-wrap gap-4 [--delay:320ms]">
            <ButtonLink href="/account" variant="flame" size="lg" className="group min-h-14 gap-2 shadow-[6px_6px_0_0_var(--color-ink)] transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_var(--color-ink)] active:translate-y-0 active:scale-[0.97] active:shadow-[3px_3px_0_0_var(--color-ink)]">
              Open your account
              <ArrowUpRight aria-hidden className="size-5 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </ButtonLink>
            <ButtonLink href="#custos-at-work" variant="paper" size="lg" className="min-h-14 gap-2 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]">
              Watch Custos work
              <ArrowDownRight aria-hidden className="size-5" />
            </ButtonLink>
          </div>
          <a href="#proof" className="rise-in group mt-12 flex max-w-xl items-baseline gap-4 border-t border-paper/60 pt-5 [--delay:420ms]">
            <span className="tnum shrink-0 font-mono text-2xl sm:text-3xl">6.421094</span>
            <span className="text-sm leading-relaxed text-paper">
              USDG of debt repaid by Custos on testnet, straight from the vault, with no owner signature.{" "}
              <span className="whitespace-nowrap underline decoration-paper/60 underline-offset-4 transition-colors group-hover:decoration-paper">See the receipt</span>
            </span>
          </a>
        </div>
        <div className="rise-in min-w-0 [--delay:180ms]">
          <LiveCustosConsole />
        </div>
      </div>
    </section>
  );
}
