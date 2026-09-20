"use client";

import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";

import { CellLabel } from "@/components/ui/cell";
import { carry, policyBand, routeFacts } from "@/lib/content";

/**
 * Questions: the objections a reader has before trusting the claim, answered
 * in the same order they arrive, with the exact caps and selectors that make
 * each answer true.
 *
 * Answers are static text, never generated or personalized, and every amount
 * comes from the same manifest the rest of the page reads. A closed row keeps
 * its answer in the DOM behind a measured height so a reader with JavaScript
 * disabled still gets the full text.
 */

const questions = [
  {
    q: "Who can create debt on this account?",
    a: `Only the owner, and only inside the caps written into the account. Additional borrowing needs owner approval in MVP; there is no automation path that opens a position. Custos can never borrow, and it cannot raise a cap.`,
  },
  {
    q: "What can Custos actually call?",
    a: `Three selectors, and nothing else: freezeBorrowing(), repayFromReserve(uint256), repayFromStrategy(uint256). Each one can only move this account's own debt down. There is no receiver parameter, no venue parameter, and no arbitrary call.`,
  },
  {
    q: "What happens when the vault cannot pay out?",
    a: `Repayment is bounded by what the vault reports as withdrawable at the current block. Quoted assets are not withdrawable assets, so a quoted balance that the vault cannot honour sizes nothing. If liquidity is short, borrowing stays frozen and the shortfall is printed.`,
  },
  {
    q: "Is the yield guaranteed?",
    a: `No. The vault APY of ${carry.vaultApy} and the borrow APY of ${carry.borrowApy} were observed at ${carry.observedAt}, which makes the net spread of ${carry.netSpread} an estimate, not a payment. If the spread inverts, the Guardian tightens instead of adding debt.`,
  },
  {
    q: "Does Crest ever touch the stock tokens?",
    a: `No sales, no swaps, and no transfers out. The collateral sits in the one verified Morpho market, where collateral APY is 0.00% by design. Yield belongs to the deployed loan token, so the two never blur.`,
  },
  {
    q: "What if someone gets hold of the Guardian key?",
    a: `The damage is capped by the contract, not by trust. The Guardian still cannot choose a receiver, a market, or a vault, cannot move value out, and cannot unfreeze. The owner can revoke it and unfreeze the account at any time.`,
  },
  {
    q: "Why should the numbers be believed?",
    a: `Every figure on this page binds at build time to the reviewed route manifest: ${routeFacts.chain} block ${routeFacts.block}, ${routeFacts.finality} finality, market ${routeFacts.marketId.slice(0, 10)} and vault ${routeFacts.vault.slice(0, 10)}. Nothing here is projected onto a chart as if it already happened.`,
  },
] as const;

export function QuestionsSection() {
  const [open, setOpen] = useState(0);
  const reduce = useReducedMotion();

  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-label="Questions">
      <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
        <div>
          <CellLabel>07 · Questions</CellLabel>
          <h2 className="type-display mt-4 max-w-3xl text-poster-lg text-ink sm:text-poster-xl">
            Ask the awkward ones first.
          </h2>
        </div>
        <p className="max-w-md text-poster-sm text-ink-soft">
          Policy band on this account: lower {policyBand.lower}%, target{" "}
          {policyBand.target}%, upper guard {policyBand.upper}%, critical{" "}
          {policyBand.critical}% against a Morpho LLTV of {policyBand.lltv}%.
        </p>
      </div>

      <LazyMotion features={domAnimation} strict>
        <ul className="border-t border-ink">
          {questions.map((item, index) => {
            const isOpen = open === index;
            return (
              <li key={item.q} className="border-b border-ink">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`answer-${index}`}
                    id={`question-${index}`}
                    onClick={() => setOpen(isOpen ? -1 : index)}
                    className="flex w-full items-center gap-5 py-5 text-left transition-colors duration-150 hover:bg-crest-100 focus-visible:bg-crest-100"
                  >
                    <span className="type-display tnum w-10 shrink-0 text-poster-base text-ink-soft">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="type-display flex-1 text-poster-md text-ink uppercase">
                      {item.q}
                    </span>
                    <m.span
                      aria-hidden
                      initial={false}
                      animate={{ rotate: isOpen ? 45 : 0 }}
                      transition={
                        reduce
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 420, damping: 30 }
                      }
                      className="relative grid size-8 shrink-0 place-items-center border border-ink bg-paper"
                    >
                      <span className="absolute h-3 w-px bg-ink" />
                      <span className="absolute h-px w-3 bg-ink" />
                    </m.span>
                  </button>
                </h3>

                <m.div
                  id={`answer-${index}`}
                  role="region"
                  aria-labelledby={`question-${index}`}
                  initial={false}
                  animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : {
                          height: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
                          opacity: { duration: 0.18 },
                        }
                  }
                  className="overflow-hidden"
                >
                  <p className="max-w-2xl pb-6 pl-15 text-poster-base text-ink-soft">{item.a}</p>
                </m.div>
              </li>
            );
          })}
        </ul>
      </LazyMotion>
    </section>
  );
}
