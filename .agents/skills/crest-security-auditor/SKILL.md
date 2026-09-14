---
name: crest-security-auditor
description: Use when reviewing Crest authority, custody, Morpho/vault calls, transaction construction, data inputs, automation, secrets, or risk claims.
---

# Crest Security Auditor

## Posture
Assume callers, APIs, RPCs, tokens, vaults, stale data, UI input, and Guardian credentials are untrusted. Review against `technical/SMART-CONTRACT.md`, `technical/INTEGRATIONS.md`, and `technical/ERD.md`.

## Required checks
- Map every external function to owner, Guardian, or public authority; prove owner-only debt creation and Guardian's three fixed selectors.
- Check arbitrary execution, delegatecall, approval escalation, reentrancy, replay, unsafe tokens, rounding, decimals, share inflation/loss, and stale-state faults.
- Prove vault redemption receiver, Morpho repayment beneficiary, fixed venue, floors/caps, `maxWithdraw`, partial liquidity, and debt-decrease postcondition.
- Prove degraded Robinhood/oracle/rate/vault data cannot set price, increase capacity, or enable borrowing.
- Verify exact simulation precedes signature and canonical receipts/postconditions follow submission.
- Verify secrets never enter source, browser storage, logs, fixtures, or output.

## Findings
For each finding: severity, file/symbol, preconditions, realistic impact, exploit path, and minimal remediation. A clean review names the reviewed commit and unreviewed boundaries.
