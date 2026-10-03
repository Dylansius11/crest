# Crest Design System

**Source marks:** `apps/web/public/crest-bw-no-bg.png` (ink plate, for blue fields), `apps/web/public/crest-logo-no-bg.png` (brand-blue plate, for paper and light surfaces)
**Design objective:** Make asset intent, LTV, yield liquidity, Guardian authority, and realized debt repayment legible before encouraging leverage.
**Visual language:** printed poster. One blue field, one paper field, hard 1px rules, huge condensed type, and offset ink shadows instead of soft elevation.

This document is normative for every Crest screen. It changed on 2026-09-20 from an institutional light theme to the poster system below; the product-honesty rules are unchanged.

## 1. Brand foundation

Crest should feel controlled, transparent, and calm under pressure, printed rather than styled.

Brand attributes:

- **Protective:** downside actions are explicit and bounded.
- **Legible:** exact amounts, rates, permissions, and evidence.
- **Honest:** projected carry never looks realized; unsupported routes remain visible.
- **Consent-first:** additional borrowing is clearly an owner action.
- **Loud where it matters, quiet everywhere else:** the poster voice is reserved for the claim and the authority story; every number stays in plain, ruled tables.

Use “Crest” in prose and the supplied wordmark in brand placement.

### 1.1 Guardian naming

`Custos` is the name of the Crest Guardian, the automation an owner authorizes. Naming never changes authority:

- Custos is the Guardian role from `docs/technical/SMART-CONTRACT.md`; the three selectors are unchanged.
- Copy states what Custos may call and what it may never do in the same breath as any name-drop.
- Never present Custos as an advisor, an agent with discretion, or an AI that decides. It executes a fixed policy and a fixed route.
- Post-MVP automation (signed borrow envelope, target-LTV upsize) must be labeled as such and must not be attributed to Custos in MVP screens.

## 2. Logo rules

- Minimum digital width: `144px`; header and footer render it at `56px` height or more.
- Clear space: at least the cap-height of the `C`.
- Use the ink variant on the blue field; use the blue plate variant on paper or light surfaces. Never place the blue plate on the blue field.
- Do not recolor either raster, add gradients or soft shadows, or turn the plate slope into a price chart.
- Accessible name: `Crest`.
- Confirm trademark status before production claims.

### 2.1 Brand geometry

The wordmark plate drops `3.5%` of its width across the top edge. This slope is the only recurring brand geometry: it may appear as a section divider, a headline underline, or a diagonal hatch. Cards, tables, forms, charts, and numeric regions stay rectangular.

## 3. Color tokens

Tokens are declared once in `apps/web/src/app/globals.css` under `@theme`. Values below are sampled from the supplied artwork, not chosen by eye.

```css
:root {
  /* Brand blue ramp, anchored at the logo plate #006AFC */
  --color-crest-100: #d9e6ff;
  --color-crest-200: #b8d0ff;
  --color-crest-300: #8ab2ff;
  --color-crest-400: #4d8bff;
  --color-crest-500: #006afc;
  --color-crest-600: #0057d6;
  --color-crest-700: #0044ab;
  --color-crest-900: #06214f;
  --color-crest-950: #041630;

  /* Ink and paper */
  --color-ink: #0a1626;
  --color-ink-soft: #33414f;
  --color-paper: #f5f4f0;
  --color-paper-soft: #efeee9;

  /* Signals */
  --color-signal-verified: #0e7a46;
  --color-signal-warn: #a35a00;
  --color-signal-stop: #b3231a;
  --color-signal-degraded: #6f52a8;

  /* The single orange: owner actions and the primary CTA */
  --color-flame: #ff4d1c;
  --color-flame-press: #e63e10;
}
```

### Semantic rules

| State | Color | Required label |
|---|---|---|
| Normal | Ink on paper | `Normal` |
| Owner approval | Ink outline or flame plate | `Owner approval required` |
| Intervention verified | Green | `Debt reduced` plus exact amount |
| Warning | Amber, or the flame plate at full bleed | `Warning` plus threshold/source |
| Critical | Red | `Critical` plus action |
| Degraded/unknown | Purple | `Degraded` or `Unknown` |
| Unsupported | Slate | `Unsupported` plus reason |

Blue never means safe. Green is reserved for a verified outcome. Color always has text and an icon.

### Color usage budget

- One blue field and one paper field per screen length; never alternate them section by section without a purpose.
- The text-bearing blue field is `crest-600`, not the logo plate `crest-500`: 13 to 16px paper text measures 4.27:1 on the lighter plate and fails AA, while the deeper plate measures 5.6:1. `crest-500` stays for large display type, decorative fills, and the logo, where the 3:1 large-text rule applies.
- Text on a blue field never uses an opacity modifier (`text-paper/80` and friends). Reduced-opacity paper sinks below AA on blue; use full `text-paper` and separate ideas with rules instead.
- Flame is budgeted: primary CTA, the Guardian-cannot plate, the closing headline line. At most three flame surfaces per screen, and never two of them adjacent. Ink on flame is the only legible pairing (5.2:1); paper on flame is 3.0:1 and is prohibited at any size below the large-text threshold.
- Secondary actions on a blue field use the paper pill (`bg-paper text-ink`), not a paper outline with paper text.
- Hard offset shadows (`shadow-[Npx_Npx_0_0_...]`) are reserved for objects that represent authority or money movement. Everything else is flat.

## 4. Typography

- Display/headings: `Archivo Variable` (variable width, set to `font-stretch: 87.5%`), fallback `Arial Narrow, system-ui`.
- Body/UI: `Inter Variable`, fallback `system-ui`.
- Amounts, rates, addresses, policy, timestamps: `IBM Plex Mono`, fallback `ui-monospace`.
- Logo: supplied artwork only.

Type scale (`--text-poster-*`): `sm` 13px, `base` 16px, `md` 24px, `lg` 36px, `xl` 56px, `2xl` 80px, `3xl` 120px. Display sizes carry tight leading (`0.86` to `0.98`) and tight tracking.

Rules:

- Display type is always uppercase and always reserves its own line: a headline line never shares a row with body copy.
- Display type never sets numbers. Numbers use the mono face with tabular figures (`.tnum`).
- Every percentage includes metric and basis: `Current LTV`, `Target LTV`, `Morpho LLTV`, `Borrow APY`, `Vault APY`.
- Body copy measures cap at roughly `65ch`.
- The scale is registered as a font-size group for `tailwind-merge` in `apps/web/src/lib/cn.ts`. Without that entry the merge helper files `text-poster-*` under text color and silently drops a real color class from the same `cn()` call, so any new size token must be added there too.

## 5. Layout

- Base spacing: `4px`; scale `4, 8, 12, 16, 24, 32, 48, 64, 96`.
- Rules: `1px` solid ink on paper, `1px` solid paper on blue. Hairline grids come from `gap-px` over an ink or paper background, never from borders on every child.
- Cell/card radius: `2px` to `4px`. Controls: `2px`.
- Page gutters: `20px` mobile, `40px` from `sm`.
- Content maximum: `1360px`.
- Texture: dotted `22px` grid on both fields; a diagonal hatch band may mark a transition. Texture never sits under body copy at full opacity.
- Minimum target: `44x44px`.
- Mobile: one column; action state, LTV, debt, and withdrawable liquidity precede charts.

## 6. Information hierarchy

Position screen order:

1. account, chain, environment, block/time, and data freshness;
2. Guardian state and exact allowed next action;
3. debt, collateral value, current LTV, target band, and Morpho LLTV;
4. idle reserve and currently withdrawable strategy liquidity;
5. borrow APY, vault APY, incentives, fees, and estimated net carry;
6. realized strategy earnings and realized debt repaid;
7. exact market/vault identities and qualification status;
8. owner versus Guardian permissions;
9. lifecycle/oracle/vault/rate provenance;
10. intervention timeline and transaction evidence;
11. stress scenarios and limitations.

The account page derives one of five modes from wallet, registry, and position state (`apps/web/src/lib/account-mode.ts`), so first-time owners get guidance and returning owners skip it:

1. `welcome`: no wallet and no look-up. Two doors: connect a wallet to manage, or read any account by address without signing.
2. `loading`: wallet connected, registry or position still reading. Nothing is guessed while it loads.
3. `setup`: a connected wallet with no recorded account. A guided five-step flow, the only place numbered steps appear: connect, choose the manifest collateral and loan-token intent (symbols come from the active manifest), create the account, set the rules, then add collateral and borrow. Each step is a separate owner approval.
4. `dashboard`: the connected wallet is the recorded owner. A plain-language status headline (`positionHeadline`), a five-fact key strip (debt, Current LTV, collateral, withdrawable from vault, Custos last action), then tabs Overview, Manage, Rules, Evidence. Overview carries the Custos card, LTV band, capital, carry, and realized debt reduction; Manage carries supply, owner-only borrow, repay, withdraw, and unfreeze, each simulated against a live chain read with one sticky transaction panel and a review sheet before signature; Evidence carries permissions, the one-block live read, provenance, and canonical receipts.
5. `inspect`: a look-up of an account the wallet does not own. The same dashboard, labelled read-only, with Manage removed.

Unavailable values stay visible with their reason, never as zero. Custos is credited only for a verified postcondition; a pre-sign skip reads "Skipped before signing. Nothing was signed."

A sandbox route puts a "Sandbox: read disclosures" chip in the account header that opens every manifest disclosure in a popover. It is always in the header, never a footnote.

The wallet chooser uses EIP-6963 announcements so multiple extensions remain separately selectable.
The legacy `window.ethereum` provider appears only when no wallet announces itself. Provider
names are self-attested, so the signer must confirm the extension's actual request.

Landing-page order (marketing surface, same rules, different emphasis). There is no sandbox band on the landing page; the live console and every testnet fact carry their own "Robinhood Chain Testnet" label instead:

1. cover: the claim, the "Open your account" CTA, the 6.421094 USDG receipt line, and the live Custos console;
2. one bad day: a pinned four-step illustration (price falls, freeze, reserve repay, vault repay) on the owner's LTV band, labelled as an illustration;
3. proof: the three real testnet transactions, each with its block and explorer link;
4. authority: what the owner can do, the three Custos selectors, and what Custos cannot do;
5. how it works: the three-move sequence;
6. the band: owner limits against Morpho LLTV;
7. the carry: both APY sides and realized debt reduction;
8. the reviewed mainnet route, archived, with the pinned-fork evidence;
9. questions, then the footer CTA.

No kicker or eyebrow labels above headlines, and no decorative section numbers.

Never place “Borrow more” above the risk/liquidity summary. It is always an owner-approval card.

## 7. Core components

### 7.1 Live Custos console

Landing-page centrepiece. It reads the recorded position of the demo account the VPS Guardian watches (`/v1/accounts/<address>/position`) and shows, in order:

1. identity strip: `Custos on duty` and the label `Live on Robinhood Chain Testnet`;
2. the guarded account address;
3. the plain-language headline from `positionHeadline`, with a one-time FROZEN stamp only when the snapshot says frozen;
4. borrowing state, recorded block, policy nonce, Guardian address, and the observation age with its UTC time;
5. the three callable selectors, each with the outcome it can produce;
6. the sandbox line: test tokens, mock oracle, idle-only vault, only the owner can create debt.

It shows a "Reading the account" state while the request is in flight and "Live status unavailable" when it fails or the response does not match the demo account on chain 46630. It never shows a balance, a rate, or a projection.

### 7.2 Wallet Asset Intent Table

| Asset | Balance | Intent | Route | Status/reason |
|---|---:|---|---|---|
| NVDA Stock Token | 10 | Protect & borrow | verified market | Executable at block … |
| USDG | 1,000 | Earn stable | fixed vault | Constrained by current cap |
| AAPL Stock Token | 4 | Keep | wallet | No movement |
| Other token | 50 | Unsupported | — | No verified market/vault |

Each row offers only verified intents. `KEEP` does not request approval. Unsupported rows are not hidden.

### 7.3 LTV Band Panel

```text
Current LTV       38.2%
Lower             30.0%
Target            35.0%
Upper guard       42.0%
Critical          50.0%
Morpho LLTV       62.5%

[---- lower -- target -- current -- upper ---- critical ---- LLTV]
```

Also show:

- debt required to reach target;
- repayment needed to return to target;
- additional-borrow capacity as `Owner approval required`;
- source block and oracle status.

The band may be scrubbed by scroll on marketing surfaces. Zone labels may brighten as the sweep passes them; the numbers themselves never count, tick, or animate.

Do not combine LTV with health factor. Show Morpho health and policy health in a secondary exact table.

### 7.4 Capital Allocation Panel

```text
Collateral in Morpho                 10 NVDA
Morpho collateral APY                0.00%
Accrued debt                         2,000 USDG
Idle protected reserve                 500 USDG
Vault quoted assets                  1,520 USDG
Currently withdrawable               1,350 USDG
Guardian-actionable                    850 USDG
```

The hierarchy must prevent quoted vault assets from being mistaken for immediately repayable liquidity.

### 7.5 Carry Breakdown

```text
Vault base APY                  +6.20%
Incentive APR                   +0.80%
Borrow APY                      -4.10%
Vault/protocol fees             -0.30%
Estimated execution cost        -0.10%
Estimated net spread            +2.50%
Estimated annual net carry      +38.00 USDG
```

Required:

- source and timestamp for each rate;
- exact denominator;
- projected label;
- stale/degraded indicator;
- a realized section below, never blended into the estimate.

The spread may be drawn as a two-sided bar once both rates are observed: earn side in brand blue, pay side in flame. Print a net spread only when the rate windows and conventions are comparable; otherwise disclose why no net value is shown. An inverted spread is stated in words, not hidden by color.

Never make a giant negative “loan APY” the primary metric.

### 7.6 Realized Repayment Card

Only canonical post-state can turn this card green.

```text
Debt before           2,000.81 USDG
Vault withdrawn         250.00 USDG
Debt after            1,750.79 USDG
Accrued debt reduced    250.02 USDG
Status                  Verified at block …
```

An empty realized card states why it is empty. If a receipt succeeds but debt does not decrease, display `Postcondition failed`, never success.

### 7.7 Guardian State Card

States: `NORMAL`, `HARVESTABLE`, `UPSIZE_AVAILABLE`, `PROTECT`, `EXIT_YIELD`, `CRITICAL`, `DEGRADED`.

Required fields:

- current state and reason code;
- triggering threshold/input;
- policy version;
- exact permitted selector;
- requested, capped, simulated, and actual amount;
- owner action needed;
- receipt/postcondition.

### 7.8 Permission Inspector

```text
Owner can:
configure · borrow-and-deploy · withdraw · unfreeze · revoke Guardian

Guardian can:
freeze · repay from idle reserve · repay from fixed vault

Guardian cannot:
borrow · unfreeze · choose venue · choose receiver · transfer · swap
sell collateral · change policy · call arbitrary targets
```

Three cells share one grid and one frame height. The Guardian-cannot cell carries the flame plate; it is the loudest cell on the page and is never larger than its siblings. Display the inspector before Guardian authorization and on every position.

### 7.9 Intervention Bento

One intervention is laid out as tiles sized by weight, not chronology:

- largest tile: the verified debt reduction, with before, after, and reduced amounts on ruled figures;
- guard and freeze tiles at half width;
- liquidity refresh, repayment submission, and restored policy as smaller tiles;
- one flame tile stating the failure path.

Every tile carries its timestamp in mono. The sequence is labeled illustrative when it is not a live receipt, and the illustrative label is part of the tile, not a footnote.

### 7.10 Route Verification Drawer

Morpho:

- five exact MarketParams and derived ID;
- deployment/token code hashes;
- LLTV, oracle freshness, liquidity;
- verification block/time.

Vault:

- exact chain/address/code/interface/asset;
- upgrade/manager/curator disclosure;
- caps, pause, fees, downstream allocations;
- quoted versus withdrawable assets;
- verification block/time.

Use `Verified at block …`, not an unqualified checkmark. A rotating stamp may carry the same fact; the stamp is decoration, the sentence is the record.

### 7.11 Evidence Provenance

Onchain oracle, Morpho state, vault state, rate sources, and Robinhood lifecycle data are separate rows. Each shows source, generated/fetched time, block where applicable, freshness, use, and non-use.

### 7.12 Disclosure list (questions)

The objections that precede trust, as ruled rows: a two-digit index, the question in display type, and a square plus that becomes a cross.

- Single-open by default; a second row opening closes the first.
- The trigger is a real `<button>` with `aria-expanded`; the panel is a `region` labelled by its question.
- Height animates between `0` and `auto` with Motion, and the indicator rotates on a spring. Under reduced motion both transitions are zero-duration, so the row simply appears.
- The answer text is complete in the DOM whether or not the panel is expanded, so a reader without JavaScript sees every answer.
- Answers are static product copy. Never generate one per visitor, and never soften a cap or a failure path to make an answer shorter.

## 8. Motion

- Library split: GSAP with ScrollTrigger for scroll-linked sequences; Motion for component-level transitions.
- GSAP runs only in client components, inside `useGSAP` with a scope ref, and is registered once.
- `prefers-reduced-motion` is a hard gate: every effect lives inside `gsap.matchMedia()` on `(prefers-reduced-motion: no-preference)`, so reduced motion renders a static page rather than a faster one.
- Durations: `120–180ms` for state feedback, `400–800ms` for entrance reveals, `200–240ms` for drawers and modals.
- Allowed: mask wipes on headline lines, one batched settle for cells, a clip wipe on the proof grid, a rail that draws with scroll, the pinned illustration stepper, a slow rotating verification stamp, and the hero's CSS entrance (rise with a short blur, staggered, plus the one-time FROZEN stamp). The hero entrance is CSS so it runs at first paint and never leaves the cover hidden waiting for hydration.
- Forbidden: any animation of a debt, balance, rate, or LTV value; counters and odometers; pulses that repeat; animating debt down before a canonical postcondition; countdowns; parallax that moves text off its baseline; anything that replays on scroll-back.
- Texture and decoration may drift; content may not.

## 9. Copy system

### Use

- “Keep the stock. Watch the debt. Prove everything.”
- “Custos can reduce this account's debt; only you can create it.”
- “Three selectors, and every one of them moves debt down.”
- “Estimated net spread: 4.01% inverted at the observed block.”
- “Realized debt reduced: 250.02 USDG, verified at block 66,386,239.”
- “850 USDG is currently withdrawable and permitted for repayment.”
- “Additional borrow available; owner approval required.”
- “Yield route unavailable; reserve-only protection remains.”

### Never use

- “Liquidation-proof.”
- “Guaranteed self-repaying.”
- “Risk-free” or “guaranteed negative APY.”
- “Collateral earns Morpho yield.”
- “Custos keeps you safe” or any phrasing that gives the Guardian judgment it does not have.
- “Best yield” without a verified full comparison.
- “Trading halt stops liquidation.”
- “Every Stock Token is supported.”
- “Auto-borrowing” for MVP.
- Em dashes, exclamation marks, and hype adjectives such as “revolutionary” or “seamless.”

## 10. Transaction confirmation

Every owner transaction preview shows:

- chain/environment/account;
- Crest Account, Morpho, and vault addresses;
- selector and exact route;
- token/amount and share bounds (vault share minimums and maximums derive from a simulated preview with a stated 50 bps margin; withdrawals name the owner wallet as the only receiver);
- current/resulting debt and LTV;
- caps/floors affected;
- simulation block/gas;
- whether Guardian authority changes.

High-risk owner actions — raising debt or strategy caps, lowering floors, changing Guardian, or unfreezing — use a precise consequence statement.

## 11. States and recovery

| State | UI treatment | Recovery |
|---|---|---|
| Sandbox route (46630) | Account header chip opens every manifest disclosure; landing facts carry a testnet label; owner signing enabled | None needed; never label it reviewed or live mainnet |
| Signing-disabled route | Readable evidence page, no transaction controls | Owner funds and approves a canary separately |
| Wrong network | Stop note with one-click switch to the manifest chain | Switch or add the chain in the wallet |
| Assessment missing or stale (over 10 min) | Borrow closed with the reason | Wait for a fresh monitor poll |
| Assessment DEGRADED on sandbox | Reason codes plus an explicit owner acknowledgement before a borrow can be simulated | Acknowledge, or wait for healthy inputs |
| Assessment DEGRADED on reviewed route | Borrow closed | Wait for healthy inputs |
| Market unsupported | Route blocked with gate reason | Select verified route |
| Vault unsupported | Yield disabled; reserve-only available | Verify another same-asset vault later |
| Rate stale/spread below floor | No new borrow recommendation | Refresh or wait |
| Oracle stale/paused | Critical/degraded; freeze | Wait for valid onchain source |
| Vault withdrawal constrained | Show quoted/withdrawable gap | Partial repay and owner alert |
| Reserve/strategy at floor | Guardian amount zero | Owner changes policy or adds funds |
| Guardian transaction pending | Hash/nonce state | Reconcile; no duplicate |
| Repay reverted | Failure reason | Keep frozen; fresh assessment |
| Debt unchanged | Postcondition failure | Keep frozen; owner review |

## 12. Accessibility

- WCAG 2.2 AA contrast. Ink on paper and paper on brand blue both clear it; flame requires ink text only.
- Full keyboard setup, visible focus on every control, and focus parity with hover on interactive cells.
- Status uses icon, text, and accessible description.
- Charts and gauges include a table or an accessible text equivalent.
- Critical numbers and permissions have mobile parity.
- Decorative layers are `aria-hidden`; duplicated ticker content is read once.

## 13. Design acceptance

- A first-time judge identifies owner versus Guardian debt authority in under 10 seconds.
- A first-time visitor can name what Custos may do, and what it may never do, without scrolling.
- Wallet assets clearly show keep, borrow, earn, and unsupported intent.
- Current LTV, policy band, and Morpho LLTV cannot be confused.
- Morpho collateral APY displays as zero.
- Quoted vault assets and withdrawable repayment liquidity cannot be confused.
- Projected net carry and realized debt repayment cannot be confused.
- Every intervention shows exact receipt and debt before/after.
- Live, forked, simulated, cached, projected, and illustrative states are unmistakable.
- The page holds its layout with JavaScript disabled and with reduced motion enabled.
