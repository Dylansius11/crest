# Crest Agent Context

Use this file to orient an agent with no prior conversation. It captures non-obvious decisions and corrected assumptions; linked specifications are normative.

## 1. What Crest is

Crest is an Arbitrum Open House 2026 product targeting Robinhood Chain **testnet 46630** first. No primary source publishes a qualifiable 46630 route, so the owner chose a labeled **SANDBOX** (2026-10-02): `config/deployment-manifest.46630.json` carries trust tier `sandbox` with disclosures, every chain-bound service binds to the active manifest, and the owner workspace signs real testnet transactions only with those disclosures visible. The checked-in 4663 manifest and fork proof stay registered as reviewed mainnet evidence with signing disabled.

> Crest lets an owner keep exposure to one supported Robinhood Stock Token, borrow USDG through one verified Morpho market, deploy eligible USDG into one fixed yield vault, and authorize Crest Guardian to freeze or repay—but never increase debt—in MVP.

The old working name was **PrimeLayer**. Use **Crest** in all new artifacts. Historical strategy documents may still use PrimeLayer.

## 2. The central correction

Crest does **not** create one collateral asset, protocol-level cross-margin, or a new line of credit.

Morpho markets are isolated. A wallet’s AAPL, NVDA, WETH, or hedge outside one market does not change that market’s LLTV. Crest may show one conservative aggregate capacity view later, but onchain debt/collateral remains separate.

Wrapping assets into a basket does not make that basket accepted collateral, create an oracle, attract lenders, or ensure liquidation liquidity.

## 3. Decisions already made

1. MVP starts with one verified Morpho market and one verified loan-token yield vault.
2. One non-upgradeable `CrestAccount` owns one Morpho position and the fixed vault shares.
3. The owner chooses each visible wallet asset intent: `KEEP`, `PROTECT_AND_BORROW`, `EARN_STABLE`, or `UNSUPPORTED`.
4. `PROTECT_AND_BORROW` is executable for one qualified collateral route; unsupported assets remain visible with reasons.
5. Morpho collateral earns no protocol yield. Crest yield comes from the loan token deployed to the configured vault.
6. Owner alone supplies collateral, creates debt, changes policy, withdraws, or unfreezes.
7. Crest Guardian may only freeze, repay from idle reserve, or redeem from the fixed vault directly into repayment of the account's own debt.
8. Tier 0 monitoring, Tier 1 freeze, Tier 2 reserve repayment, and Tier 3 fixed-strategy repayment are MVP.
9. Additional borrowing after LTV falls is an owner-approved recommendation in MVP.
10. A time-limited owner-signed borrow envelope is Post-MVP A; no general agent borrowing permission exists.
11. Stock Token lifecycle data is an advisory tightening input, not the product headline and never an onchain price authority.
12. No basket, arbitrary routing, operator-selected venue, collateral sale, universal router, or Stylus exists in MVP.

Do not reopen without new official/runtime evidence.

## 4. Intervention tiers

| Tier | Meaning | Status |
|---|---|---|
| 0 | Observe Morpho position, rates, oracle, vault liquidity, and Stock Token lifecycle | MVP |
| 1 | Guardian sets borrowing freeze; only owner clears it | MVP |
| 2 | Guardian repays bounded debt from idle loan-token reserve above the signed floor | MVP |
| 3 | Guardian redeems bounded assets from the exact configured vault and sends them only to the account's own Morpho debt | MVP, gated on one verified vault |
| 4 | Borrow more toward target LTV under an expiring owner-signed envelope | Post-MVP A |
| 5 | Use several isolated positions/strategies or an audited collateral unwind | Post-MVP B/later |

MVP posture: **autonomous downside, consented upside**. Never call Tier 1 alone auto-deleveraging; Tier 2/3 must prove an actual debt decrease.

## 5. Critical external facts

### Robinhood Chain/Stock Tokens

- Current official docs identify Robinhood Chain mainnet as EVM chain ID `4663` with ETH gas.
- Stock Tokens are tokenized debt securities providing economic exposure, not legal ownership of underlying equity.
- Availability is jurisdiction-restricted.
- `/rhj/assets`, `/prices/{symbol}`, and `/corporate-actions` are read-only lifecycle/context sources with caching/rate semantics.
- `isTradingHalt` is an underlying-market signal; it does not prove token transfers/liquidations stop.
- Stock Token UI multiplier changes exposure display without rebasing raw ERC-20 balance.
- Official onchain feed guidance says the token feed already includes multiplier. Do not multiply twice.
- `oraclePaused()` is advisory; feed freshness/sequencer checks remain necessary.

### Morpho

A market is exactly loan token, collateral token, oracle, IRM, and LLTV. Market creation does not create liquidity. Morpho collateral earns no yield; suppliers of the loan asset earn interest through supply shares. Use fresh accrued debt/share math for caps and repayments. Full close should use fresh borrow shares; automated repayments are bounded partial asset repayments.

## 6. Trust model

### Authority order

1. Deployed Crest Account state and canonical chain receipt.
2. Exact Morpho market/position/oracle state at an identified block.
3. Exact configured vault state, share accounting, and currently withdrawable loan-token liquidity.
4. Verified official deployment manifest.
5. Deterministic risk/policy code over cited inputs.
6. Robinhood REST lifecycle signal and offchain rate observations with timestamps.
7. LLM explanation/draft.

Lower layers cannot override higher layers.

### Guardian compromise model

A compromised Guardian may cause a nuisance freeze or use permitted account-owned reserve/vault assets to repay the owner's own debt. It must not borrow, unfreeze, redirect funds, change venue, or extract value. Prove this from the ABI/call graph and invariant tests, not an API allowlist.

## 7. Contract invariants to protect

- exact configured Morpho market and fixed vault only;
- freeze blocks every Crest borrow;
- supplied collateral never exceeds cap;
- fresh accrued debt plus requested owner borrow never exceeds ceiling;
- Guardian cannot create debt in MVP;
- reserve and strategy repayment respect per-action caps and configured floors;
- strategy redemption receiver is the Crest Account and proceeds flow only into its own Morpho debt;
- Guardian cannot unfreeze, change policy, withdraw, transfer, swap, sell collateral, or select a venue;
- no arbitrary call, delegatecall, proxy, plugin, or generic token approval;
- market, loan token, collateral token, or vault cannot change while an active position or strategy balance remains.

See [Smart Contract](./technical/SMART-CONTRACT.md).

## 8. Honest MVP proof

The judge should see:

1. exact canonical Stock Token, Morpho market, and stablecoin-vault verification;
2. wallet assets classified as keep, executable, constrained, or unsupported with reasons;
3. typed target/upper/critical LTV, debt, reserve, strategy, spread, and repayment policy;
4. owner-approved small collateral supply plus borrow-and-deploy;
5. exact Morpho debt, vault shares, withdrawable assets, borrow APY, vault APY, and estimated carry;
6. an over-cap/frozen borrow reverting;
7. a reproducible downside or spread-degradation trigger;
8. Guardian freezing, redeeming a bounded amount, and repaying the account's own debt;
9. debt/health before and after with canonical receipt and provenance;
10. upside capacity presented as an owner approval, not an autonomous MVP borrow;
11. Post-MVP A signed-envelope borrowing and Post-MVP B portfolio allocation clearly unavailable.

Without a live usable market and vault, ship the verified reserve-only protection path and label yield execution unavailable. Never invent liquidity, APY, or a self-repayment result.

## 9. Build gates before polish

- official chain/deployment/market manifest verified;
- one Morpho market passes identity/oracle/liquidity/fork gate;
- one loan-token vault passes asset/interface/withdrawal/loss/fork gate;
- account role/cap/floor/vault invariants pass Foundry tests;
- pinned fork completes supply → owner borrow-and-deploy → freeze → strategy repay → withdraw;
- Morpho collateral yield is displayed as zero and net-carry math uses explicit sources/denominators;
- degraded REST/oracle/rate/vault data cannot increase capacity;
- duplicate trigger submits at most once and postconditions reconcile.

Stop broad UI work if the market or vault route fails. Preserve the reserve-only fallback rather than substituting a mock yield source.

## 10. Vocabulary

| Term | Meaning |
|---|---|
| Crest Account | Purpose-built contract owning one Morpho position, loan-token reserve, and fixed-vault shares |
| Owner | Sole authority for policy, debt creation, value withdrawal, and unfreeze |
| Crest Guardian | Least-power automation role: freeze plus bounded own-debt repayment |
| Asset intent | `KEEP`, `PROTECT_AND_BORROW`, `EARN_STABLE`, or `UNSUPPORTED` |
| Market ID | Hash/identity of exact five Morpho parameters |
| Yield vault | One qualified loan-token strategy with fixed address and tested withdrawal behavior |
| Morpho health | Position margin relative to protocol LLTV |
| Policy health | Margin relative to stricter owner policy |
| LTV band | Owner-signed lower, target, upper, and critical LTV thresholds |
| Reserve floor | Idle loan-token balance automation/withdrawal cannot cross without owner policy change |
| Strategy liquidity | Loan-token assets currently withdrawable from configured vault, not quoted TVL |
| Net carry | Estimated strategy earnings and incentives minus debt cost and execution/strategy fees |
| Realized debt repayment | Canonically observed reduction in accrued Morpho debt attributable to a strategy action |
| Lifecycle signal | Robinhood metadata/halt/multiplier/corporate-action observation used only to tighten |
| Degraded | Required source stale, paused, unavailable, conflicting, illiquid, or unknown |
| Verified intervention | Canonical receipt plus postconditions on debt, reserve, and strategy state |

## 11. Document reading order

1. [Strategy](./STRATEGY.md)
2. [PRD](./PRD.md)
3. [Architecture](./technical/ARCHITECTURE.md)
4. [Smart Contract](./technical/SMART-CONTRACT.md)
5. [Integrations](./technical/INTEGRATIONS.md)
6. [ERD](./technical/ERD.md)
7. [Tech Stack](./technical/TECH-STACK.md)
8. [Design System](./DESIGN-SYSTEMS.md)
9. [Build Plan](./BUILD-PLAN.md)
10. [Installation](./technical/INSTALLATION.md)

Conflict authority: PRD for product scope; Smart Contract for onchain permissions/invariants; Architecture for boundaries/trust; ERD for persisted units/relationships. Update every affected document together.

## 12. Agent working rules

- Verify addresses, market params, vault asset/interface, withdrawal liquidity, rates, fees, APIs, and chain state from current official sources/runtime.
- Never infer AAPL/NVDA/WETH/USDG support from a ticker or dashboard category.
- Use SDKs for convenience, but verify exact MarketParams, vault deployment, and onchain state.
- Treat REST, LLM, metadata, rate APIs, RPC providers, and UI input as untrusted.
- Preserve explicit units/scales; never combine multiplier, feed decimals, WAD, APY scale, and token decimals implicitly.
- Offchain degradation may only tighten behavior.
- Never label Stock Token price/dividend exposure or Morpho collateral as lending APY.
- Show estimated net carry separately from realized debt repayment and always include absolute stablecoin amounts.
- Do not add dormant Post-MVP A/B methods “for later.”
- Do not add a generic executor to save code.
- Before interface changes, update contract ABI, services, UI, tests, docs, and manifest consumers.
- Runtime fork/mainnet proof outranks architectural prose.
- Label live, forked, simulated, cached, projected, and illustrative evidence.

## 13. Current repository/tool state

This repository currently contains Crest planning artifacts, not an implementation.

Verified:

- supplied logo at `crest-logo.png`;
- dominant logo blue around `#236AD8`–`#2D71DB`;
- complete Crest product/technical documents and concise `AGENTS.md`;
- project-local development skills under `.agents/skills/`;
- exact stable bootstrap versions recorded in [Tech Stack](./technical/TECH-STACK.md).

Implementation dependencies, contracts, services, and UI do not exist yet. Install and prove them only through the gated [Build Plan](./BUILD-PLAN.md).

## 14. Brand/copy constraints

Crest should feel controlled and legible, not speculative. Never say:

- liquidation-proof or guaranteed self-repaying;
- risk-free or guaranteed negative APY;
- Morpho collateral earns yield;
- cross-margin;
- autonomous additional borrowing in MVP;
- “best yield” without a complete verified comparison;
- trading halt automatically stops token transfer/liquidation;
- Stock Token ownership equals underlying equity ownership;
- supported market/vault without exact runtime verification.

Always distinguish Morpho health from policy health, projected net carry from realized debt repayment, and quoted vault assets from currently withdrawable strategy liquidity.

## 15. Primary source map

- Strategy reference: [Hobba founder demo](https://www.loom.com/share/5de3ab70886e49f2a3bf2efded4e6909), [Hobba](https://hobba.io/)
- Event: [Arbitrum Open House Singapore](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon)
- Chain/assets: [Arbitrum docs](https://docs.arbitrum.io/), [Robinhood Chain](https://docs.robinhood.com/chain/), [Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/), [Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- Lending/yield: [Morpho market mechanics](https://docs.morpho.org/developers/borrow/concepts/market-mechanics/), [Morpho LTV/health](https://docs.morpho.org/developers/borrow/concepts/ltv/), [Robinhood Earn](https://robinhood.com/us/en/crypto/earn/)

## 16. Unknowns to resolve at implementation kickoff

Validation gates, not placeholders in shipped code:

- exact current Robinhood Morpho deployment and one qualifying market;
- current canonical collateral/loan token and oracle addresses/code hashes;
- useful loan-token liquidity and request size;
- exact current yield vault address, asset, curator/authority, fees, caps, pause, and withdrawal behavior;
- live borrow/vault APY sources and update semantics;
- official oracle heartbeat/sequencer behavior for selected market;
- contract compiler/Morpho/ERC-4626 interface package compatibility;
- live versus forked action that event rules and funding allow;
- final event track/submission requirements.

Record resolved facts in reviewed `deployment-manifest.json` with sources, block, time, and code hashes.
