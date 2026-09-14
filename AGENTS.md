# Crest Development Guide

## Mission
Build Crest as a policy-controlled Stock Token borrowing product: owner-approved debt, one verified Morpho market, one fixed loan-token vault, and a Guardian that can only freeze or reduce the account's own debt.

This repository currently contains specifications, not a working implementation. Never present planned, forked, simulated, cached, or projected behavior as live.

## Read only what the task needs
1. Start with `CONTEXT.md`.
2. Product scope: `STRATEGY.md` and `PRD.md`.
3. Boundaries: `technical/ARCHITECTURE.md`.
4. Contract authority: `technical/SMART-CONTRACT.md`.
5. Then read only the relevant integration, ERD, UI, stack, installation, or build-plan document.

Conflict order: PRD owns product scope; Smart Contract owns onchain permissions; Architecture owns trust boundaries; current deployed state and reproducible runtime evidence outrank prose.

## Non-negotiable MVP invariants
- One non-upgradeable `CrestAccount`, one exact Morpho market, one exact loan token, one fixed qualified vault.
- Owner alone creates debt, changes policy, unfreezes, withdraws value, or changes Guardian.
- Guardian has only `freezeBorrowing()`, `repayFromReserve(uint256)`, and `repayFromStrategy(uint256)`.
- Guardian cannot choose a receiver, market, vault, swap, sale, approval, or arbitrary call.
- Morpho collateral APY is zero; yield belongs to deployed loan-token assets.
- Current withdrawable vault liquidity—not shares, quoted assets, or TVL—bounds strategy repayment.
- Projected net carry, realized strategy earnings, and canonical debt reduction are separate facts.
- Stale, paused, conflicting, unavailable, or illiquid input can only tighten behavior.
- Additional borrowing requires owner approval in MVP. Signed-envelope automation is Post-MVP A.
- Unsupported assets/routes stay visible with reasons; never fabricate liquidity, APY, addresses, or support.

## Engineering loop
1. Reproduce or define one observable contract.
2. Verify exact chain, addresses, code hashes, market parameters, vault asset/interface, block/time, units, and sources.
3. Write the failing behavior/invariant first for permanent logic changes.
4. Make the smallest source fix; do not add dormant Post-MVP code or parallel conventions.
5. Simulate every transaction before signature; reconcile canonical receipt and postconditions after submission.
6. Run the narrow check plus the real smoke path. For contract changes, include unit/fuzz/invariant and pinned-fork coverage.
7. Update every affected ABI, caller, schema, manifest, UI state, test, and normative document in the same cutover.

## Security and evidence
Treat wallets, Guardian credentials, APIs, RPCs, tokens, vaults, rates, metadata, UI input, and LLM output as untrusted. Preserve bigint units/scales and block context. Never log secrets. No generic executor, proxy, custom oracle, collateral sale, dynamic router, Redis, Kafka, Rust, or Stylus in MVP.

Use `technical/TECH-STACK.md` for exact bootstrap versions. Re-check official stable releases and compatibility before changing pins; newest independently is not necessarily compatible or safer.

## Delivery
Return changed files, exact checks and observed results, assumptions, unresolved runtime gates, and one next action. Do not claim completion without behavioral evidence.

## Self Learning Logs
Newest first. Add only a verified, reusable technical lesson in one line: `YYYY-MM-DD — Root cause → rule`.

- 2026-09-13 — Morpho collateral does not earn supply yield → attribute yield only to deployed loan-token assets.
- 2026-09-13 — A broad automation key turns optimization into custody risk → enforce Guardian authority in the contract ABI, not an HTTP allowlist.

## Self Insight Logs
Newest first. Add only a durable user/workflow preference in one line: `YYYY-MM-DD — Observation → application`.

- 2026-09-13 — The user wants ambitious output without speculative complexity → maximize product quality while keeping MVP authority and stack minimal.
- 2026-09-13 — Repeated context must stay compact → link normative docs instead of duplicating full specifications here.
