# Crest Implementation Plan

> Use the `executing-plans` workflow in a separate implementation session. Complete tasks in order; the market-and-vault gate can stop the yield-loop scope.

**Goal:** Build one policy-controlled Robinhood Chain account where the owner creates debt and Crest Guardian can only freeze or repay that account's debt from idle reserve or one fixed loan-token vault.
**Architecture:** [technical/ARCHITECTURE.md](./technical/ARCHITECTURE.md)
**Contract:** [technical/SMART-CONTRACT.md](./technical/SMART-CONTRACT.md)
**Product:** [PRD.md](./PRD.md)

## Global constraints

- One verified Morpho market and one verified same-loan-token vault.
- Morpho collateral APY is zero.
- Owner alone borrows in MVP.
- Guardian exposes only freeze, reserve repay, and fixed-strategy repay.
- No arbitrary call, receiver, route, swap, collateral sale, proxy, or Stylus.
- Current withdrawable vault assets—not TVL or quoted APY—bound repayment.
- Projected carry and realized debt repayment stay separate.
- Failed vault gate produces reserve-only fallback, not mock yield.
- Exact amounts, shares, rates, and WAD values use bigint/integer math.

## Target file map

```text
contracts/src/CrestAccount.sol
contracts/test/*
config/deployment-manifest.*
packages/domain
packages/morpho
packages/vault
packages/rates
packages/robinhood
packages/chain
packages/policy
packages/risk
packages/db
apps/monitor
apps/automation
apps/api
apps/web
```

## Task 1: Verify one complete market-and-vault route

**Files**

- Create `config/deployment-manifest.schema.json`
- Create `config/deployment-manifest.json`
- Create `scripts/verify-deployment-manifest.ts`
- Create read-only verification packages/tests needed for the gate

**Steps**

- [x] Read current official Robinhood, Morpho, vault, and ERC-4626 sources.
- [x] Verify chain ID, Morpho code, tokens, decimals, oracle, IRM, LLTV, and derived market ID.
- [x] Read current market supply, borrow, and available loan liquidity.
- [x] Discover a same-loan-token yield vault; verify address, code, interface, `asset()`, roles, upgrades, fees, caps, pause, queue/loss behavior, and downstream allocations.
- [x] Observe borrow rate and vault rate with explicit convention/source/freshness.
- [x] Measure vault `maxDeposit`, `maxWithdraw`, and `maxRedeem` for the planned account/request.
- [x] Execute pinned-fork market supply/borrow/repay/withdraw.
- [x] Execute pinned-fork vault deposit/withdraw and record actual share rounding.
- [x] Record every source, retrieval time, verification block/hash, address, and code hash.
- [x] Make the verifier fail on altered chain, code, market ID, vault asset, or block evidence.

**Acceptance**

One route passes both gates. If market passes but vault fails, record `reserve_only` and continue without any yield claim. If market fails, stop product implementation.

## Task 2: Scaffold workspace and domain model

**Files**

- Create workspace/TypeScript/Foundry/PostgreSQL configuration
- Create `packages/domain/src/{identity,units,asset-intent,policy,risk,carry,guardian}.ts`
- Create `packages/db` schema/migration from [ERD](./technical/ERD.md)

**Steps**

- [ ] Bootstrap the exact compatible version set in [Tech Stack](./technical/TECH-STACK.md); commit exact `packageManager`, lockfile, Foundry, and Solidity pins.
- [ ] Define branded addresses, hashes, market/vault IDs, base units, shares, WAD, BPS, block, and rate types.
- [ ] Define `KEEP`, `PROTECT_AND_BORROW`, `EARN_STABLE`, `EARN_ASSET`, and `UNSUPPORTED`.
- [ ] Define Guardian states and action kinds.
- [ ] Generate JSON Schema/OpenAPI types from Zod rather than duplicating definitions.
- [ ] Implement PostgreSQL tables, FKs, CHECKs, idempotency indexes, and reorg fields.
- [ ] Reject floats, invalid LTV ordering, mismatched loan/vault asset, projected-as-realized data, and invalid Guardian selectors.
- [ ] Apply migration to a fresh database and exercise insert/read round trips.

**Acceptance**

All financial values restore exactly to bigint/rational types; database constraints enforce route, policy, and projected/realized boundaries.

## Task 3: Implement CrestAccount test-first

**Files**

- Create `contracts/src/CrestAccount.sol`
- Create Morpho/vault/token mocks
- Create unit/fuzz/invariant tests
- Create deployment script

**Steps**

- [ ] Write failing owner/Guardian/stranger permission tests for every function.
- [ ] Write failing tests for exact market/vault identity, vault asset mismatch, active-route reconfiguration, freeze, collateral/debt/strategy caps, LTV ordering, reserve/strategy floors, share slippage, repayment cap, and zero repayment.
- [ ] Implement owner/configuration and immutable Morpho boundary.
- [ ] Implement collateral supply and owner-only `borrowAndDeploy`.
- [ ] Force borrowed loan token to Crest Account then fixed vault; enforce minimum shares.
- [ ] Implement owner strategy deposit/withdraw and owner repay/withdraw.
- [ ] Implement `freezeBorrowing`, `repayFromReserve`, and `repayFromStrategy`.
- [ ] Fix strategy withdrawal receiver and Morpho repayment beneficiary to Crest Account.
- [ ] Use exact temporary approvals and reentrancy protection.
- [ ] Emit complete policy, borrow/deploy, strategy, and repayment evidence.
- [ ] Add invariant handler proving all contract invariants under arbitrary sequences.

**Acceptance**

ABI contains no Guardian borrowing, unfreeze, receiver, venue, arbitrary call, swap, or collateral-sale path. Every successful Guardian value path decreases own debt.

## Task 4: Prove contract against pinned Robinhood state

**Files**

- Create `contracts/test/RobinhoodFork.t.sol`
- Generate `packages/contracts` ABI/deployment types

**Steps**

- [ ] Pin fork to manifest block and verify chain.
- [ ] Deploy Crest Account using exact market/vault route.
- [ ] Fund disposable fork owner and Guardian.
- [ ] Supply collateral and execute small owner `borrowAndDeploy`.
- [ ] Assert exact borrowed assets, vault shares, and resulting debt.
- [ ] Assert over-cap/frozen/Guardian borrow attempts fail.
- [ ] Accrue interest and prove debt ceiling uses fresh rounded-up debt.
- [ ] Constrain mock/live vault withdrawal and prove `maxWithdraw` bounds strategy repayment.
- [ ] Execute reserve repayment and strategy repayment.
- [ ] Prove debt decreased and floors/caps/receivers held.
- [ ] Complete owner exit according to Morpho/vault semantics.
- [ ] Fail CI on source/ABI drift.

**Acceptance**

Pinned fork completes supply → owner borrow-and-deploy → Guardian freeze → bounded strategy repay → owner exit using only manifest values.

## Task 5: Build Morpho, vault, rate, and lifecycle adapters

**Files**

- Create `packages/morpho`
- Create `packages/vault`
- Create `packages/rates`
- Create `packages/robinhood`
- Create `packages/chain`

**Steps**

- [ ] Validate all external responses.
- [ ] Preserve provider source, generation/fetch time, expiry, block/hash, and reason codes.
- [ ] Implement exact market/position/accrued-debt/liquidity reads.
- [ ] Implement exact vault identity, share/assets, `maxWithdraw`, and pause/cap reads.
- [ ] Implement withdrawal simulation.
- [ ] Normalize borrow APY, vault APY, incentives, fees, and conventions without merging them.
- [ ] Implement Stock Token identity, multiplier, halt, and corporate-action observations.
- [ ] Add tests for stale/unknown/conflicting inputs, multiplier double-adjustment, vault loss, withdrawal constraint, and rate-convention mismatch.
- [ ] Run read-only smoke against manifest at a recorded block/time.

**Acceptance**

Every adapter output is independently attributable. Degraded inputs cannot appear normal or increase capacity.

## Task 6: Implement policy, risk, carry, and action planning

**Files**

- Create `packages/policy`
- Create `packages/risk`
- Create `config/scenarios.v2.json`

**Public contracts**

```ts
assessPosition(input: RiskInput): RiskAssessment
planGuardianAction(input: ActionInput): GuardianAction
estimateCarry(input: CarryInput): CarryEstimate
toConfigurationCall(policy: CompiledPolicy): PreparedOwnerTransaction
```

**Steps**

- [ ] Write policy tests for route identity, asset intents, LTV ordering, caps/floors, and forbidden Guardian debt.
- [ ] Write LTV/health/target-debt tests for no debt and every exact threshold.
- [ ] Write reserve/strategy repayment tests around `maxWithdraw`, floors, cap, and debt.
- [ ] Write carry tests separating borrow APY, vault APY, incentive, fee, estimate, and realized fields.
- [ ] Prove a small debt denominator cannot hide absolute dollar values in output.
- [ ] Prove degraded data produces zero owner-borrow capacity but preserves safe debt-reduction planning.
- [ ] Implement manual typed policy first; optional LLM only drafts.
- [ ] Add labeled collateral-drop, spread-inversion, and vault-liquidity scenarios.
- [ ] Ensure same versioned inputs produce the same assessment/action.

**Acceptance**

The pure module returns one deterministic Guardian state/action and one separate owner recommendation. Guardian never receives an additional-borrow action in MVP.

## Task 7: Persist observations and run monitor

**Files**

- Create database repositories for registry, snapshots, rates, policy, assessments, triggers, realized events
- Create `apps/monitor`

**Steps**

- [ ] Index Crest, Morpho, and vault events with block hashes/cursors.
- [ ] Activate policy mirror only after canonical event.
- [ ] Poll coherent market/account/vault state and timestamped advisory sources.
- [ ] Persist immutable assessment inputs and carry estimate.
- [ ] Create idempotent freeze/reserve-repay/strategy-repay triggers transactionally.
- [ ] Create owner additional-borrow recommendation without a Guardian trigger.
- [ ] Handle duplicate polls, stale rate/lifecycle, vault constraint/loss, policy change, restart, and reorg.
- [ ] Attribute canonical debt reductions to realized strategy events.

**Acceptance**

Replay creates no duplicate trigger. Projected fields never create realized repayment records.

## Task 8: Implement isolated Crest Guardian

**Files**

- Create `apps/automation/src/{claim,validate,simulate,submit,reconcile,postconditions}.ts`
- Create Guardian database repository/tests

**Steps**

- [ ] Start only through an explicit command with expected chain/account/Guardian.
- [ ] Atomically claim by idempotency key.
- [ ] Refresh policy nonce, freeze, debt, reserve, vault shares/assets, and `maxWithdraw`.
- [ ] Permit exactly three contract selectors.
- [ ] Simulate from Guardian address.
- [ ] Persist attempt/hash before retry decisions.
- [ ] Reconcile canonical receipt plus Crest/Morpho/vault post-state.
- [ ] Require debt decrease and corresponding floors/receiver/beneficiary checks.
- [ ] Test duplicate delivery, restart, dropped/reverted transaction, changed policy, withdrawal constraint, and no-debt state.

**Acceptance**

Compromised API/monitor cannot make Guardian borrow or redirect value; duplicate triggers submit at most once.

## Task 9: Expose typed API and web flows

**Files**

- Create routes/services for inventory, routes, accounts, policy, assessments, recommendations, interventions
- Create web screens/components from [DESIGN-SYSTEMS](./DESIGN-SYSTEMS.md)

**Steps**

- [ ] Build disconnected wallet inventory with explicit asset intent.
- [ ] Build combined market/vault verification with fallback.
- [ ] Build draft → typed policy → exact calldata consequence preview.
- [ ] Build owner deploy/configure/supply/borrow-and-deploy flow.
- [ ] Build LTV band, capital allocation, carry breakdown, realized repayment, permission, and evidence components.
- [ ] Show quoted versus withdrawable vault assets.
- [ ] Make additional borrow an owner approval.
- [ ] Cover wrong chain, unsupported route, stale rate, vault constrained/loss, frozen, no debt, floor reached, transaction failure, and postcondition failure.
- [ ] Verify keyboard flow, reduced motion, and narrow viewport.

**Acceptance**

A first-time judge can distinguish owner versus Guardian authority, projected versus realized economics, and quoted versus withdrawable liquidity without reading docs.

## Task 10: Execute the demo scenario

**Files**

- Create `scripts/smoke-demo.ts`
- Create event-period evidence artifact

**Steps**

- [ ] Inventory wallet and select one executable plus unsupported intents.
- [ ] Open exact route evidence.
- [ ] Configure target band, caps, floors, net-spread minimum, and Guardian.
- [ ] Owner signs small supply and borrow-and-deploy.
- [ ] Observe exact debt, shares, withdrawable liquidity, and current rates.
- [ ] Attempt forbidden borrow and capture revert.
- [ ] Trigger a labeled fork collateral-drop or spread-degradation scenario.
- [ ] Guardian freezes and repays from fixed strategy.
- [ ] Capture receipt, debt before/after, LTV/health change, and floor/cap results.
- [ ] Show upside capacity waiting for owner approval.

**Acceptance**

The demo proves useful autonomous downside management without autonomous debt creation or promotional APY.

## Task 11: Mainnet canary and final review

**Steps**

- [ ] Reverify route, code hashes, liquidity, rates, and lifecycle state.
- [ ] Run contract security/authority review and spec consistency review.
- [ ] Deploy/verify source with small limits.
- [ ] Execute canary owner supply → borrow-and-deploy → Guardian freeze → bounded repay → owner close.
- [ ] Record exact hashes, blocks, policy, shares, debt, floors, and environment.
- [ ] Test Guardian revocation, owner unfreeze, and process recovery.
- [ ] Run focused Foundry, package, database, API, browser, and canary checks.
- [ ] Confirm no Post-MVP A/B authority entered release.

**Acceptance**

Live evidence proves the route and debt reduction, or the submission explicitly labels the fork boundary and reserve-only fallback.

## Post-MVP A plan — do not start with MVP

New audited contract version:

- EIP-712 borrow envelope;
- exact route, additional-debt cap, expiry, nonce, cooldown, daily cap;
- LTV and minimum-spread conditions;
- forced deposit to fixed vault;
- revocation and action postconditions.

## Post-MVP B plan — do not start with MVP

- coordinator for several one-market accounts;
- independent gate for every added strategy;
- verified `EARN_ASSET` routes;
- owner priority across repay/reserve/earnings;
- risk-adjusted ranking;
- separate fixed swap/unwind design only after security review.

## Final self-review

- Every PRD requirement maps to a task/check.
- Manifest contains no invented address, rate, or source.
- Morpho collateral APY is zero everywhere.
- Guardian has exactly three MVP selectors and no debt authority.
- Fixed vault receiver/repayment beneficiary are provable.
- Rate conventions and projected/realized fields cannot mix.
- Withdrawal liquidity constrains repayment.
- Reorg/idempotency/postconditions are tested.
- UI labels live, forked, simulated, cached, projected, illustrative, and realized evidence.
