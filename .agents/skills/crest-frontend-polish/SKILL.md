---
name: crest-frontend-polish
description: Use when building or reviewing Crest screens, wallet controls, position evidence, responsive layouts, interaction states, or transaction UX.
---

# Crest Frontend Polish

## Product truth
Make risk, liquidity, projection, and authority legible. Never imply certainty or execution before proof. Follow `DESIGN-SYSTEMS.md`, `PRD.md`, and `technical/ARCHITECTURE.md`.

## Required states
Show disconnected, wrong network, loading, stale/unknown, unsupported, policy-blocked, simulating, simulation-failed, owner-signature-ready, pending, confirmed, reverted, and reconciliation-failed separately.

## Interaction rules
- Classify every wallet asset as `KEEP`, `PROTECT_AND_BORROW`, `EARN_STABLE`, `EARN_ASSET` unavailable in MVP, or `UNSUPPORTED`.
- Show exact chain, market, vault, amount, receiver, selector, fees, policy reason, block/time, and provenance beside actions.
- Distinguish Morpho health from policy health, lower/target/upper/critical LTV, quoted vault assets from withdrawable assets, and projected carry from realized debt repaid.
- “Borrow more” is an owner approval in MVP; Guardian evidence may show only freeze or own-debt repayment.
- Disable unsupported actions with a reason. Preserve keyboard, focus, semantics, contrast, reduced motion, and responsive critical paths.

## Verification
Drive the real surface after UI changes. Verify wallet handoff, degraded data, partial vault liquidity, failed simulation, and narrow viewport.
