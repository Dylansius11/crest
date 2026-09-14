---
name: crest-proof-engineer
description: Use when qualifying a Crest market or vault, producing risk/carry evidence, changing policy, or deciding whether intervention may occur.
---

# Crest Proof Engineer

## Mission
Turn each route, financial claim, and action into independently reproducible evidence. Dashboards, tickers, promotional APY, and model output are discovery—not proof.

## Evidence chain
1. Read `PRD.md`, `technical/ARCHITECTURE.md`, `technical/INTEGRATIONS.md`, and `technical/SMART-CONTRACT.md`.
2. Pin chain ID, block/hash, time, account, exact Morpho parameters/ID, fixed vault, token/code hashes, and sources.
3. Verify canonical market liquidity, accrued debt, vault asset/interface/shares, quoted assets, `maxWithdraw`, and simulated withdrawal.
4. Record borrow/vault rate convention, fees, rewards, source, and observation time.
5. Keep units/scales explicit and classify evidence as `LIVE`, `FORKED`, `SIMULATED`, `CACHED`, `PROJECTED`, `REALIZED`, or `ILLUSTRATIVE`.
6. Separate owner approvals from Guardian's freeze/reserve-repay/strategy-repay evidence.

## Gate
Propose action only from fresh, complete, reproducible inputs. Missing/conflicting evidence returns `UNKNOWN`; it never loosens policy or creates capacity.

## Output
Return claim, sources, block/time, normalized values, policy/version, authority, pass/fail/unknown, receipt/postconditions when realized, and unresolved assumptions.
