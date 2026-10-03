# Crest UI Redesign Implementation Plan

> **For agentic workers:** Execute task by task; steps use checkbox (`- [ ]`) syntax. Tasks 2–3 and 4–5 run as two parallel tracks with disjoint files.

**Goal:** Ship the Custos-led landing page and the mode-aware `/account` (welcome, guided setup, dashboard, read-only inspect) without touching contracts, API, database, or Custos.

**Architecture:** Two pure modules (`account-mode.ts`, `position-headline.ts`) decide what the account page shows and what it says first. `account-workspace.tsx` keeps every state hook and handler and renders one mode component. The landing page keeps its poster world and gets a new hero, a live Custos console, a pinned GSAP sequence, and a proof section.

**Tech Stack:** Next.js 16.3.5, React 19.3.0, Tailwind CSS 4.3.3 (`@theme` in `globals.css`), GSAP 3.15.0 + `@gsap/react` 2.1.2 + ScrollTrigger, Motion 13.4.0 (`motion/react`), lucide-react 1.47.0, viem 2.56.8, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-03-crest-ui-redesign-design.md`

## Global Constraints

- UI only. Do not edit `contracts/`, `apps/api`, `apps/monitor`, `apps/automation`, `packages/`, `config/`, `supabase/`, `deploy/`, or `apps/web/next.config.ts`.
- Do not change handler behaviour in `account-workspace.tsx`; move JSX, not logic. Every existing gate (`borrowGate`, `borrowSignatureBlock`, `configurationBlockedReason`, `exitBlockedReason`, `preparedBlockedReason`, reconciliation) keeps its inputs and outputs.
- English copy. No em dashes, no exclamation marks, no hype adjectives, never "keeps you safe", "liquidation-proof", "guaranteed", "risk-free", "auto-borrowing".
- No kicker or eyebrow labels above headings; no decorative section numbers. Numbered steps are allowed only in the guided setup, where order is information.
- Never animate a debt, balance, rate, or LTV value; no counters, no repeating pulses, nothing replays on scroll-back.
- Content visible by default; animation only enhances. `prefers-reduced-motion: reduce` renders static.
- TypeScript: `Record` lookups over switch chains, no inline `as` casts, no non-null assertions, no `ReturnType<typeof fn>`, bigint for units.
- Keep tokens from `globals.css`; reuse `ui/button.tsx`, `ui/badge.tsx`, `ui/cell.tsx`, `ui/logo.tsx`.

---

### Task 1: Account mode and status headline (pure logic)

**Files:**
- Create: `apps/web/src/lib/account-mode.ts`, `apps/web/src/lib/account-mode.test.ts`
- Create: `apps/web/src/lib/position-headline.ts`, `apps/web/src/lib/position-headline.test.ts`

**Interfaces (produced):**

```ts
export type AccountMode = "welcome" | "loading" | "setup" | "dashboard" | "inspect";
export type AccountModeInput = {
  wallet: WalletState;
  registryLoaded: boolean;
  registryCount: number;
  selected: { policyNonce: string; owner: string | null; lookedUp: boolean } | null;
  setupInProgress: boolean;
};
export function accountMode(input: AccountModeInput): AccountMode;

export type HeadlineTone = "stop" | "warn" | "verified" | "neutral";
export type PositionHeadline = { tone: HeadlineTone; title: string; detail: string };
export function positionHeadline(position: RecordedPosition | null, nowMs: number): PositionHeadline;
export function unreadableInputs(position: RecordedPosition | null): string[];
```

- [x] Write failing tests for every mode transition and for headlines: no record, no snapshot, frozen with unreadable inputs (names the USDG price feed and the Robinhood stock registry, excludes rate inputs), frozen after a verified Custos freeze, open and NORMAL, PROTECT or CRITICAL, DEGRADED while open, stale assessment.
- [x] Run `pnpm --filter @crest/web test` and see them fail.
- [x] Implement both modules.
- [x] Run the tests and see them pass.
- [x] Commit `feat(web): derive account mode and a plain status headline`.

### Task 2: Account shell, welcome, dashboard, inspect, review sheet

**Files:**
- Modify: `apps/web/src/components/account/account-workspace.tsx` (render only; add `lookedUp` and `setupInProgress` state)
- Create: `apps/web/src/components/account/account-header.tsx`, `welcome-view.tsx`, `account-dashboard.tsx`, `status-headline.tsx`, `key-strip.tsx`, `disclosure-chip.tsx`, `review-sheet.tsx`
- Modify as needed: `guardian-state-card.tsx` (plain label for failed pre-sign attempts), `sandbox-notice.tsx` (content reused by the chip), `transaction-panel.tsx` (content reused by the sheet)

**Interfaces:** consumes Task 1. The header carries the wallet controls, account switcher, "Look up an account", and the sandbox disclosure chip. The dashboard renders the headline, the key strip, and the tabs Overview, Manage, Rules, Evidence; Manage and Rules editing are hidden in `inspect`.

- [x] Compose the modes; keep every handler wired to the same props it has today.
- [x] `tsc --noEmit` clean at the end of the track.
- [x] Commit `feat(web): give returning owners a dashboard and look-ups a read-only view`.

### Task 3: Guided setup

**Files:**
- Create: `apps/web/src/components/account/setup-flow.tsx`, `setup-step.tsx`
- Reuse: `inventory-table.tsx`, `deploy-panel.tsx`, `policy-editor.tsx`, `entry-panel.tsx`, `review-sheet.tsx`

Order: Connect wallet, Choose assets, Create your account, Set your rules, Add collateral and borrow. One step open, completed steps collapse to a summary, a progress rail, Back and Continue, "Details" disclosures. Wrong chain shows the switch inside step 1.

- [x] Build the flow; land on the dashboard when the flow finishes or the account already has a policy.
- [x] Commit `feat(web): guide first-time owners through setup one step at a time`.

### Task 4: Landing restructure, hero, live console, proof

**Files:**
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/components/site/hero.tsx`, `site-header.tsx`, `site-footer.tsx`, `route-section.tsx`, `how-it-works.tsx`, `authority-section.tsx`, `policy-band-section.tsx`, `carry-section.tsx`, `questions-section.tsx`, `apps/web/src/lib/content.ts`
- Create: `apps/web/src/components/site/live-custos-console.tsx`, `proof-section.tsx`
- Delete when obsolete: `custos-panel.tsx`, `guardian-console.tsx`, `timeline-section.tsx`

- [x] Remove the sandbox band; label testnet data where it appears and title the route section as the archived reviewed mainnet route.
- [x] Hero copy and CTAs per spec; live console reads `/v1/accounts/<featured>/position` with a static fallback.
- [x] Proof section from `docs/evidence/canary-live-46630.json` and `hosted-guardian-46630.json` figures, explorer links from `testnetManifest.network.explorerUrl`.
- [x] Commit `feat(web): lead the landing page with a live Custos console and real proof`.

### Task 5: Signature sequence and motion

**Files:**
- Create: `apps/web/src/components/site/custos-at-work.tsx`
- Modify: `apps/web/src/components/site/reveal-provider.tsx`, `policy-band-gauge.tsx`

- [x] Pinned ScrollTrigger sequence with four discrete steps (price falls, freeze, repay from reserve, repay from vault), labeled Illustration, static stacked layout under reduced motion.
- [x] One orchestrated entrance per section family; no identical fade on every block.
- [x] Commit `feat(web): show Custos handling a bad day in one pinned sequence`.

### Task 6: Integrate, verify, document, deploy

- [x] `pnpm --filter @crest/web test`, `pnpm --filter @crest/web exec tsc --noEmit`, production `next build`.
- [x] Screenshots 1440 and 390 of `/` and `/account` (welcome, inspect of `0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75`); fix in one batch; one confirm round.
- [x] `impeccable detect --json` on changed files; fix mechanical findings.
- [x] Update `docs/DESIGN-SYSTEMS.md` (account modes, landing order, removed kickers) and `docs/LESSONS.md` if a lesson is verified.
- [ ] `npx vercel@62.2.0 deploy --prod --yes`; smoke `https://crestguard.vercel.app`.
