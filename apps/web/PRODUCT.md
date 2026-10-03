# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Hackathon judges deciding in seconds whether Crest is real, safe, and different.
- First-time stock-token holders who want cash without selling and have never used DeFi.
- DeFi-native borrowers who want exact routes, numbers, and proof before they sign.
- Returning owners who already deployed an account and come back to see what Custos did and where their assets are.

## Product Purpose

Crest lets an owner borrow USDG against one Robinhood Stock Token through one verified Morpho market, park the loan in one fixed USDG vault, and authorize a Guardian named Custos that can only freeze new borrowing or repay that account's own debt. Success: a visitor understands that in ten seconds, an owner can set up an account without a guide, and a returning owner sees Custos's work and their position on arrival.

## Positioning

The Guardian is bounded by the contract, not by a promise: three selectors (`freezeBorrowing`, `repayFromReserve`, `repayFromStrategy`), and every one of them moves debt down or stops new debt. Only the owner creates debt. Neighbouring products automate leverage; Crest automates only the brake.

## Operating Context

- Live owner signing runs on Robinhood Chain Testnet (46630), a labeled sandbox with test tokens, a mock oracle, and an idle-only vault. The reviewed mainnet route (4663) is archived evidence; owner signing stays disabled there.
- A VPS runs the API, monitor, and Custos; the web app on Vercel reads `/v1/*` and `/rpc` through server-side rewrites.
- Owners sign every action in their own wallet after a simulation at a named block.

## Capabilities and Constraints

- Owner: deploy the account, write the policy (caps, floors, lower/target/upper/critical LTV, divergence, triggers), supply collateral, borrow and deploy into the vault, repay, withdraw, unfreeze, change Guardian.
- Custos: freeze, repay from reserve, repay from vault, bounded by the per-action cap, floors, and currently withdrawable vault liquidity.
- The AI policy draft only proposes a typed draft; the owner reviews, simulates, and signs.
- Stale, degraded, or unreadable inputs only tighten behaviour. On 46630 the USDG feed and the Stock Token registry are structurally unreadable, so the demo account stays frozen by design.
- UI changes never alter contracts, API, database, or Custos.

## Brand Commitments

- Name "Crest"; Guardian name "Custos". Supplied marks in `apps/web/public/`.
- The printed-poster world in `docs/DESIGN-SYSTEMS.md` stays: blue field, paper, ink, condensed display type, hard rules.
- Copy in English. No em dashes, no exclamation marks, no hype adjectives. Never give Custos judgment ("keeps you safe"), never claim liquidation-proof, guaranteed, or risk-free.

## Evidence on Hand

- `docs/evidence/canary-live-46630.json`: real testnet lifecycle, including the Custos freeze (tx `0x9792…df02`) and the 6.421094 USDG repayment from the vault (tx `0xe512…ce90a`, block 127634675, debt 10.000047 to 3.578953 USDG).
- `docs/evidence/hosted-guardian-46630.json`: unattended VPS Custos freeze (tx `0x86da…71d`, block 127691278).
- `config/deployment-manifest.json` (reviewed mainnet route) and `config/deployment-manifest.46630.json` (sandbox route).
- No customers, testimonials, TVL, or yield track record exist. Never invent them.

## Product Principles

1. The brake is automatic; debt is always the owner's signature.
2. Show what happened, not what might: realized, projected, and recorded facts never blur.
3. One sentence first, exact evidence one click away.
4. First-timers get a guided path; returning owners land on their position.
5. Honest labels beat warning banners: say testnet where the data is testnet.

## Accessibility & Inclusion

WCAG 2.2 AA, full keyboard paths, visible focus, reduced motion renders a static page, and the page holds with JavaScript disabled.
