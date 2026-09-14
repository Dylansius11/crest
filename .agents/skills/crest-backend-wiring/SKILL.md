---
name: crest-backend-wiring
description: Use when wiring Crest chain, Morpho, vault, rate, lifecycle, risk, persistence, jobs, transaction, or frontend boundaries.
---

# Crest Backend Wiring

## Boundary
Backend observes, evaluates, prepares, and reconciles. It never becomes custodian, price authority, or unrestricted signer.

## Required flow
1. Resolve verified chain, account, exact market, fixed vault, policy nonce, and block context.
2. Read canonical Morpho debt/collateral and vault shares/assets/`maxWithdraw`; record source block and time.
3. Normalize token decimals, WAD, basis points, feed decimals, multiplier, shares, and APR/APY explicitly.
4. Keep projected carry, realized strategy earnings, and realized debt repayment as separate types.
5. Treat stale or conflicting oracle, rate, vault, RPC, and Robinhood inputs as degradation that can only tighten.
6. Evaluate versioned policy deterministically and persist inputs, reasons, trigger, attempt, receipt, and postconditions.
7. Prepare owner transactions separately from Guardian's three fixed selectors; simulate before signing.

## Constraints
Validate every boundary. Use durable idempotency and leases; treat duplicates, reorgs, partial vault liquidity, retries, and dropped receipts as normal. Shared schemas own API/database/frontend shapes once.
