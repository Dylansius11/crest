# Crest UI redesign: Custos-led landing and a mode-aware account

Date: 2026-10-03. Status: approved by the owner in chat ("Approve, build straight away"; iterate when the result is not good enough).

## Goal

Make Crest understandable to a non-technical visitor in ten seconds, easy for a first-timer to set up, and comfortable for a returning owner, while judges and DeFi-native users still reach exact evidence in one click. UI only.

## Non-goals and boundaries

- No change to contracts, ABI, API endpoints or payloads, database, monitor, Custos, manifests, or `next.config.ts` rewrites.
- No change to transaction logic: every handler in `account-workspace.tsx` (compile, simulate, submit, reconcile, live reads, registry, inspect) keeps its behaviour. Components are re-composed, not re-implemented.
- No Post-MVP features, no invented claims, no counters on debt, balance, rate, or LTV values.
- The visual world in `docs/DESIGN-SYSTEMS.md` stays (blue field, paper, ink, Archivo condensed display, Inter body, IBM Plex Mono for data, hard 1px rules, flame accent). Composition, hierarchy, copy, and motion are rebuilt.

## Landing page (`/`, Persuade)

1. Remove the sandbox status band under the header. Honesty moves into labels: the live Custos panel says "Robinhood Chain Testnet", and the route section is titled as the reviewed mainnet route, archived.
2. Hero, Custos-led, on the blue field:
   - Headline direction: "Borrow against your stock. Custos guards the debt." Lead: "You set the limits. Custos can only freeze new borrowing or pay your debt down. It can never borrow, move, or sell."
   - Primary CTA "Open your account" to `/account`. Secondary "Watch Custos work" to the signature section.
   - Right column: a live Custos console reading `/v1/accounts/<featured account>/position` client-side (state, frozen or open, last action, block, policy nonce, Guardian, observed time), labeled Testnet. Static fallback when the API or chain is unavailable, never a fake value.
3. Signature section "One bad day, handled": a GSAP ScrollTrigger pinned sequence. A stock price falls, the LTV marker crosses target, upper, and critical, and Custos freezes, repays from reserve, then repays from the vault. Labeled "Illustration". Values switch per step; nothing tweens or counts.
4. Proof section "It already happened": the real testnet freeze and the 6.421094 USDG vault repayment (debt 10.000047 to 3.578953 USDG, block 127634675) plus the unattended VPS freeze (block 127691278), each linking to the explorer.
5. Kept and tightened: authority (owner can, Custos can, Custos cannot), how it works, the archived reviewed route, the policy band, carry, FAQ, and a closing CTA in the footer.
6. Kicker chips and decorative section numbers go. Headings carry themselves.
7. Content is visible by default. Animations are progressive enhancement and never hide content that JavaScript might not reveal.

## Account (`/account`, Operate)

The page derives one mode from state:

| Mode | When | Shows |
|---|---|---|
| `welcome` | No wallet connected and no account being looked up | Two choices: Connect wallet (owner), Look up an account (read-only) |
| `setup` | Wallet connected and no registered account, or the selected account has policy nonce 0 | Guided steps, one open at a time |
| `dashboard` | Wallet connected with a selected configured account | Owner dashboard with Manage and Rules |
| `inspect` | An account was looked up by address and the connected wallet is not its owner, or no wallet is connected | The same dashboard, read-only |

### Guided setup (first-timers)

Order fixed by the owner: 1 Connect wallet, 2 Choose assets (asset intent), 3 Create your account (deploy), 4 Set your rules (AI draft, review, sign the policy), 5 Add collateral and borrow (enter). A progress rail shows done, current, and upcoming steps. Each step has one plain sentence of purpose and a "Details" disclosure for exact routes and addresses. Completed steps collapse to a one-line summary. After step 5, or when the account has a policy, the page lands on the dashboard.

### Dashboard (returning owners and look-ups)

- Status headline: one sentence derived from the recorded position, for example "Borrowing is frozen. Custos froze it at block 127691278 because the USDG price feed is unreadable." Falls back to plain statements when no snapshot or assessment exists.
- Key strip: debt, LTV against the owner's bands (or why it is unavailable), collateral, withdrawable from the vault, Custos's last action. Always visible near the top.
- Tabs: Overview (Custos state card, LTV band, capital, carry, realized repayment), Manage (asset intent, entry, exit; owner only), Rules (policy editor and current limits; editing owner only), Evidence (permissions, route verification, provenance, exact record).
- The last-intervention card labels a failed pre-sign attempt in plain words ("Skipped before signing, nothing was signed") with the failure class in details.
- Account switcher for owners with several accounts; "Look up an account" is always reachable from the header.

### Signing

The transaction panel becomes a "Review and sign" sheet: a plain-English summary first, then every field DESIGN-SYSTEMS section 10 requires. The sandbox disclosure becomes a header chip that opens the full list of disclosures; the sheet links to it before every signature.

## Motion

- GSAP + ScrollTrigger for scroll-linked landing sequences; Motion for component transitions (step changes, tabs, sheet, disclosures).
- State feedback 120 to 180 ms, entrances 400 to 800 ms, sheets 200 to 300 ms, strong ease-out curves, short blur on crossfades.
- `prefers-reduced-motion: reduce` renders a static page. Nothing replays on scroll-back.

## Copy

English only, product voice from DESIGN-SYSTEMS section 9, no em dashes, no exclamation marks, no hype adjectives. Controls name their action; errors name the problem and the recovery.

## Testing and verification

- Pure logic gets unit tests (Vitest, colocated): account mode derivation and the status headline.
- Existing web tests stay green: `pnpm --filter @crest/web test`.
- `pnpm --filter @crest/web exec tsc --noEmit` and a production `next build`.
- Desktop (1440) and mobile (390) screenshots of `/` and `/account` in welcome, inspect, and dashboard states; `impeccable detect` on changed files.
- Deploy to Vercel and smoke `crestguard.vercel.app`; the owner runs the wallet path.
