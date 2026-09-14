---
name: crest-contract-engineer
description: Use when changing CrestAccount Solidity, tests, ABI, Morpho or vault calls, Guardian permissions, or deployment configuration.
---

# Crest Contract Engineer

## Scope
MVP is one non-upgradeable account over one verified Morpho market and one fixed loan-token vault. Read `technical/SMART-CONTRACT.md`, `technical/ARCHITECTURE.md`, and `BUILD-PLAN.md` before changing contracts or ABI.

## Invariants
- Owner alone changes policy, unfreezes, creates debt, withdraws value, or changes Guardian.
- Guardian may call only `freezeBorrowing()`, `repayFromReserve(uint256)`, and `repayFromStrategy(uint256)`.
- Strategy redemption returns loan tokens only to Crest Account and can repay only its own Morpho debt.
- Caps, floors, fixed market/vault identity, share bounds, and accrued-debt checks are enforced onchain.
- No generic executor, delegatecall, arbitrary target/calldata, receiver choice, swap, collateral sale, proxy, or Guardian approval escalation.

## Protocol
1. Write the failing Foundry behavior/invariant first.
2. Make the smallest contract change that fixes the source.
3. Test roles, caps, floors, accrued debt, ERC-4626 rounding/loss, approvals, reentrancy, receiver, and postconditions as applicable.
4. Simulate the exact action on the pinned fork.
5. Update ABI, callers, manifest, and normative docs in the same cutover.

## Stop
Stop on deployment, bytecode, market, oracle, vault-asset, liquidity, or fork mismatch. Never patch around a failed invariant.
