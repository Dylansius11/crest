# Crest Development Guide

## Mission
Build Crest as a policy-controlled Stock Token borrowing product: owner-approved debt, one verified Morpho market, one fixed loan-token vault, and a Guardian that can only freeze or reduce the account's own debt.

This repository currently contains specifications, not a working implementation. Never present planned, forked, simulated, cached, or projected behavior as live.

## Persistent instructions and focused reading
1. Read this `AGENTS.md` at session start, before every `BUILD-PLAN.md` task, before every commit, and immediately after it changes. It is the persistent operating contract, not one-time orientation.
2. Read `CONTEXT.md` once at implementation kickoff; reread it only when a product decision changes or a conflict requires re-grounding.
3. Product scope: `STRATEGY.md` and `PRD.md`.
4. Boundaries: `technical/ARCHITECTURE.md`.
5. Contract authority: `technical/SMART-CONTRACT.md`.
6. Then read only the relevant integration, ERD, UI, stack, installation, or active build-plan section.

Conflict order: PRD owns product scope; Smart Contract owns onchain permissions; Architecture owns trust boundaries; current deployed state and reproducible runtime evidence outrank prose. Official product skills refine protocol mechanics but cannot widen Crest authority.

## Skill routing
- Route verification and all Morpho Blue work: `robinhood-chain-integration`, `borrow-integration`, and `crest-proof-engineer`.
- Exact vault discovery or integration: `earn-integration` plus `crest-proof-engineer`; first identify Vault V1, Vault V2, or another interface.
- Solidity/Foundry setup and contract work: `setup-solidity-contracts`, `develop-secure-contracts`, and `crest-contract-engineer`.
- Supabase schema, connection, RLS, or operations: user-global `supabase` and `supabase-postgres-best-practices`; Supabase Postgres is the only managed database provider.
- React/Next.js work: `vercel-react-best-practices` and `crest-frontend-polish`.
- Security and release: `crest-security-auditor`, `requesting-code-review`, and `verification-before-completion`.

Load only the skills relevant to the active task. Protocol-specific official skills outrank generic examples on protocol mechanics; Crest invariants still outrank any suggestion that broadens authority or scope.

## Execution tracking and commits
- Keep all eleven `BUILD-PLAN.md` tasks visible as ordered top-level todos for the entire implementation.
- Expand only the active top-level task into one child todo per checklist item and acceptance requirement; never collapse, replace, or hide future tasks.
- A blocked gate remains visible with its exact evidence-based reason. Never skip ahead past a failed market gate.
- Commit every completed top-level task and any earlier independently reviewable, verified milestone. Never commit a failing or half-wired state.
- Before each commit, reread this file, run the narrow behavioral proof for the milestone, and consider whether a new Self Learning or Self Insight entry is warranted.

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
Newest first. At every completed build-plan task and before handoff, record any newly verified, reusable technical lesson in one line: `YYYY-MM-DD — Root cause → rule`. Do not record status, secrets, speculation, or a duplicate lesson.

- 2026-09-14 — Morpho Vault V2 deliberately returns zero from all ERC-4626 `max*` functions → identify the exact vault generation and use its fresh withdrawal options plus exact simulation instead of treating zero as unavailable liquidity.
- 2026-09-13 — Morpho collateral does not earn supply yield → attribute yield only to deployed loan-token assets.
- 2026-09-13 — A broad automation key turns optimization into custody risk → enforce Guardian authority in the contract ABI, not an HTTP allowlist.

## Self Insight Logs
Newest first. At every completed build-plan task and before handoff, record any newly observed durable user/workflow preference in one line: `YYYY-MM-DD — Observation → application`. Do not record transient status or restate an existing preference.

- 2026-09-14 — The user requires the complete Build Plan to remain visible → retain Tasks 1–11 as top-level todos and expand only the active task into checklist and acceptance children.
- 2026-09-14 — The user expects repository instructions to remain active → reread `AGENTS.md` at every task and commit boundary while treating `CONTEXT.md` as one-time orientation unless decisions change.
- 2026-09-14 — The user chose Supabase rather than Neon → use Supabase-hosted PostgreSQL and its selected global skills without introducing a second managed database provider.
- 2026-09-13 — The user wants ambitious output without speculative complexity → maximize product quality while keeping MVP authority and stack minimal.
- 2026-09-13 — Repeated context must stay compact → link normative docs instead of duplicating full specifications here.
