"use client";

import { LazyMotion, domAnimation, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { useState } from "react";

import { carry, routeFacts } from "@/lib/content";

const questions = [
  { q: "Who can borrow?", a: "Only the owner can borrow, and only within the limits written into the account. Custos cannot open a loan or raise a borrowing limit." },
  { q: "What can Custos do?", a: "Its only calls are freezeBorrowing(), repayFromReserve(uint256), and repayFromStrategy(uint256). It can stop new borrowing or repay this account's debt from its own funds. It cannot choose another receiver or vault." },
  { q: "What if the vault cannot release the money?", a: "Custos can repay only from funds the vault reports as withdrawable at the current block. A quoted balance does not mean that money can be withdrawn. Borrowing remains frozen if a repayment is not available." },
  { q: "Is the yield guaranteed?", a: `No. The archived mainnet vault APY was ${carry.vaultApy} and the borrow APY was ${carry.borrowApy}, measured across different windows. They do not provide a current net return. Custos never borrows more to chase yield.` },
  { q: "Can Custos sell my stock?", a: "No. Your collateral is held in the configured Morpho market. Custos cannot sell, swap, transfer, withdraw, or change the policy. Only the owner can authorize the actions that create debt." },
  { q: "What if someone gets the Guardian key?", a: "The contract still allows that key only to freeze borrowing or repay this account's own debt. It cannot send funds to another wallet. The owner can change the Guardian and unfreeze the account." },
  { q: "Is this running on mainnet?", a: `No. Live account signing runs on Robinhood Chain Testnet with test tokens, a mock oracle, and an idle-only vault. The reviewed mainnet route shown below is archived evidence from chain ${routeFacts.chainId}, block ${routeFacts.block}. Owner signing is disabled on that route.` },
] as const;

export function QuestionsSection() {
  const [open, setOpen] = useState(0);
  const reduce = useReducedMotion();
  return (
    <section className="paper-grid bg-paper px-5 py-24 sm:px-10" aria-labelledby="questions-heading">
      <div className="mx-auto max-w-[85rem]">
        <h2 id="questions-heading" data-reveal="headline" className="type-display max-w-3xl text-poster-lg text-ink sm:text-poster-xl">The questions worth asking.</h2>
        <LazyMotion features={domAnimation} strict>
          <ul className="mt-12 border-t border-ink">
            {questions.map((item, index) => {
              const isOpen = open === index;
              return (
                <li key={item.q} className="border-b border-ink">
                  <h3>
                    <button type="button" aria-expanded={isOpen} aria-controls={`answer-${index}`} id={`question-${index}`} onClick={() => setOpen(isOpen ? -1 : index)} className="flex min-h-16 w-full items-center gap-5 py-5 text-left transition-[background-color,transform] duration-150 hover:bg-crest-100 focus-visible:bg-crest-100 focus-visible:outline-2 focus-visible:outline-ink active:scale-[0.97]">
                      <span className="type-display flex-1 text-poster-md text-ink">{item.q}</span>
                      <m.span aria-hidden initial={false} animate={{ rotate: isOpen ? 45 : 0 }} transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }} className="relative grid size-8 shrink-0 place-items-center border border-ink bg-paper">
                        <span className="absolute h-3 w-px bg-ink" /><span className="absolute h-px w-3 bg-ink" />
                      </m.span>
                    </button>
                  </h3>
                  <m.div id={`answer-${index}`} role="region" aria-labelledby={`question-${index}`} initial={false} animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }} transition={reduce ? { duration: 0 } : { height: { duration: 0.24, ease: [0.23, 1, 0.32, 1] }, opacity: { duration: 0.18 } }} className="overflow-hidden">
                    <p className="max-w-2xl pb-6 text-base leading-relaxed text-ink-soft">{item.a}</p>
                  </m.div>
                </li>
              );
            })}
          </ul>
        </LazyMotion>
        <noscript><div className="mt-8 space-y-6 border-t border-ink pt-6">{questions.map((item) => <div key={item.q}><h3 className="type-display text-poster-md text-ink">{item.q}</h3><p className="mt-2 text-base text-ink-soft">{item.a}</p></div>)}</div></noscript>
      </div>
    </section>
  );
}
