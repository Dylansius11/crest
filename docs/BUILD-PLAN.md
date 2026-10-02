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
apps/monitor          route-drift observation
apps/automation       Crest Guardian operator CLI
apps/api              typed read-only route/authority API
apps/web              Next.js owner surface
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

- [x] Bootstrap the exact compatible version set in [Tech Stack](./technical/TECH-STACK.md); commit exact `packageManager`, lockfile, Foundry, and Solidity pins.
- [x] Define branded addresses, hashes, market/vault IDs, base units, shares, WAD, BPS, block, and rate types.
- [x] Define `KEEP`, `PROTECT_AND_BORROW`, `EARN_STABLE`, `EARN_ASSET`, and `UNSUPPORTED`.
- [x] Define Guardian states and action kinds.
- [x] Generate JSON Schema/OpenAPI types from Zod rather than duplicating definitions.
- [x] Implement PostgreSQL tables, FKs, CHECKs, idempotency indexes, and reorg fields.
- [x] Reject floats, invalid LTV ordering, mismatched loan/vault asset, projected-as-realized data, and invalid Guardian selectors.
- [x] Apply migration to a fresh database and exercise insert/read round trips.
- [x] Scaffold `apps/{web,api,monitor,automation}` on the pinned stack, each wired into workspace `typecheck`/`test`, each already serving or verifying reviewed evidence rather than placeholder data.
- [x] Move the brand mark to `apps/web/public/crest-logo.png` and bind the reviewed manifest into the web build so an unreviewed route cannot render.

**Acceptance**

All financial values restore exactly to bigint/rational types; database constraints enforce route, policy, and projected/realized boundaries.

## Task 3: Implement CrestAccount test-first

**Files**

- Create `contracts/src/CrestAccount.sol`
- Create Morpho/vault/token mocks
- Create unit/fuzz/invariant tests
- Create deployment script

**Steps**

- [x] Write failing owner/Guardian/stranger permission tests for every function.
- [x] Write failing tests for exact market/vault identity, vault asset mismatch, active-route reconfiguration, freeze, collateral/debt/strategy caps, LTV ordering, reserve/strategy floors, share slippage, repayment cap, and zero repayment.
- [x] Implement owner/configuration and immutable Morpho boundary.
- [x] Implement collateral supply and owner-only `borrowAndDeploy`.
- [x] Force borrowed loan token to Crest Account then fixed vault; enforce minimum shares.
- [x] Implement owner strategy deposit/withdraw and owner repay/withdraw.
- [x] Implement `freezeBorrowing`, `repayFromReserve`, and `repayFromStrategy`.
- [x] Fix strategy withdrawal receiver and Morpho repayment beneficiary to Crest Account.
- [x] Use exact temporary approvals and reentrancy protection.
- [x] Emit complete policy, borrow/deploy, strategy, and repayment evidence.
- [x] Add invariant handler proving all contract invariants under arbitrary sequences.

**Acceptance**

ABI contains no Guardian borrowing, unfreeze, receiver, venue, arbitrary call, swap, or collateral-sale path. Every successful Guardian value path decreases own debt.

## Task 4: Prove contract against pinned Robinhood state

**Files**

- Create `contracts/test/RobinhoodFork.t.sol`
- Generate `packages/contracts` ABI/deployment types

**Steps**

- [x] Refresh the manifest to genuinely finalized evidence, validate its hash from a successor block within the EVM 256-block window, then pin the fork and verify chain.
- [x] Deploy Crest Account using exact market/vault route.
- [x] Fund disposable fork owner and Guardian.
- [x] Supply collateral and execute small owner `borrowAndDeploy`.
- [x] Assert exact borrowed assets, vault shares, and resulting debt.
- [x] Assert over-cap/frozen/Guardian borrow attempts fail.
- [x] Accrue interest and prove debt ceiling uses fresh rounded-up debt.
- [x] Constrain mock/live vault withdrawal and prove generation-appropriate `maxWithdrawableStrategyAssets` bounds strategy repayment, including a non-1:1 native adapter share-rate boundary.
- [x] Execute reserve repayment and strategy repayment.
- [x] Prove debt decreased and floors/caps/receivers held.
- [x] Complete owner exit according to Morpho/vault semantics.
- [x] Fail CI on source/ABI drift.

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

- [x] Validate all external responses.
- [x] Preserve provider source, generation/fetch time, expiry, block/hash, and reason codes.
- [x] Implement exact market/position/accrued-debt/liquidity reads.
- [x] Implement exact vault identity, share/assets, generation-appropriate withdrawal liquidity, and pause/cap reads (`maxWithdraw` is deliberately zero for Vault V2).
- [x] Implement withdrawal simulation.
- [x] Normalize borrow APY, vault APY, incentives, fees, and conventions without merging them.
- [x] Implement Stock Token identity, multiplier, halt, and corporate-action observations.
- [x] Add tests for stale/unknown/conflicting inputs, multiplier double-adjustment, vault loss, withdrawal constraint, and rate-convention mismatch.
- [x] Run read-only smoke against manifest at a recorded block/time.

**Acceptance**

Every adapter output is independently attributable. Degraded inputs cannot appear normal or increase capacity.

**Evidence (2026-09-23)**

- Every adapter returns `Observation<T>` from `@crest/domain`: value, onchain block (number/hash/timestamp) or HTTP URL/fetch/generation/expiry/indexed block, and reason codes. Status is derived from those facts and cannot be set by a caller.
- `pnpm smoke:adapters` (LIVE, read-only) at Robinhood block `70226651` (`0xa3d972e8…e7eb839`, 2026-09-23T04:26:29Z): all nine manifest code hashes matched; market, borrower position, oracle, both feeds, vault, holder liquidity, 1 USDG withdrawal simulation (preview equals simulated shares), rates, incentives, Stock Token state, and Robinhood lifecycle all `normal`.
- The same run classified the market oracle as `feed_times_multiplier`; see [LESSONS](./LESSONS.md) and [INTEGRATIONS §4](./technical/INTEGRATIONS.md#4-stock-token-contract-and-oracle-semantics).

## Task 6: Implement policy, risk, carry, and action planning

**Files**

- Create `packages/policy`
- Create `packages/risk`
- Create `config/scenarios.v2.json`

**Public contracts**

```ts
assessPosition(input: RiskInput): RiskAssessment
planGuardianAction(input: ActionInput): GuardianAction | null
estimateCarry(input: CarryInput): CarryEstimate
toConfigurationCall(policy: CompiledPolicy): PreparedOwnerTransaction
```

**Steps**

- [x] Write policy tests for route identity, asset intents, LTV ordering, caps/floors, and forbidden Guardian debt.
- [x] Write LTV/health/target-debt tests for no debt and every exact threshold.
- [x] Write reserve/strategy repayment tests around generation-appropriate withdrawal liquidity, floors, cap, and debt.
- [x] Write carry tests separating borrow APY, vault APY, incentive, fee, estimate, and realized fields.
- [x] Prove a small debt denominator cannot hide absolute dollar values in output.
- [x] Prove degraded data produces zero owner-borrow capacity but preserves safe debt-reduction planning.
- [x] Implement manual typed policy first; optional LLM only drafts.
- [x] Add labeled collateral-drop, spread-inversion, and vault-liquidity scenarios.
- [x] Ensure same versioned inputs produce the same assessment/action.

**Acceptance**

The pure module returns one deterministic Guardian state/action and one separate owner recommendation. Guardian never receives an additional-borrow action in MVP.

**Evidence (2026-09-24)**

- `@crest/policy` (18 tests) compiles a strict typed draft against the `full_route` manifest into the exact `configure` calldata; the selector and `policyHash = keccak256(abi.encode(PolicyConfig))` are pinned to the generated ABI. No LLM path exists.
- `@crest/risk` (62 tests) runs with exact bigint arithmetic on manifest-bound fixtures: every LTV band edge at one base unit, Morpho health at the LLTV, the recorded `feed_times_multiplier` oracle (divergence exactly `uiMultiplier - 1`), degraded, skewed, foreign, illiquid, and nonce-conflicting input, reserve versus strategy selection, floors with share-rounding guards, the per-action cap, withdrawable-only liquidity, exit yield on stale rates, realized-only harvest, determinism, and all four scenarios in `config/scenarios.v2.json` (`illustrative`).
- A mutation spot-check (divergence gate, state precedence, source tie-break, strategy floor, feed age) failed the suite each time. An independent review then reproduced five defects (repayment on stale, skewed, or superseded input, two share-rounding reverts that scale with share price, illiquid strategy not degrading, stale negative spread hiding the exit); each now has a failing-first regression test, and the review re-ran against the fixes.
- Owner-borrow capacity follows the owner's oracle decision in [LESSONS](./LESSONS.md): Morpho's value, gated by Crest's feed-only divergence.

## Task 7: Persist observations and run monitor

**Files**

- Create database repositories for registry, snapshots, rates, policy, assessments, triggers, realized events
- Create `apps/monitor`

**Steps**

- [x] Index Crest, Morpho, and vault events with block hashes/cursors.
- [x] Activate policy mirror only after canonical event.
- [x] Poll coherent market/account/vault state and timestamped advisory sources through the Task 5 adapters.
- [x] Read Crest Account configuration, frozen state, and policy nonce through `@crest/chain` at the same block horizon.
- [x] Persist immutable assessment inputs and carry estimate. Unknown carry is null and real carry can be negative, so `estimated_annual_carry_assets` and `estimated_spread_bps` must become nullable, and the domain `projectedCarrySchema` must accept a negative amount, before the first insert.
- [x] Reconcile `strategyCostBasisAssets` from canonical strategy deposit and withdrawal events; until it is reconciled the engine passes null and never harvests.
- [x] Create idempotent freeze/reserve-repay/strategy-repay triggers transactionally.
- [x] Create owner additional-borrow recommendation without a Guardian trigger.
- [x] Handle duplicate polls, stale rate/lifecycle, vault constraint/loss, policy change, restart, and reorg.
- [x] Attribute canonical debt reductions to realized strategy events.

**Acceptance**

Replay creates no duplicate trigger. Projected fields never create realized repayment records.

**Evidence (2026-09-30)**

- `pnpm verify`: 14/14 typechecks and 23/23 workspace tasks passed; monitor 17/17 tests and indexed RPC filtering 6/6 passed. `pnpm --filter @crest/db test:integration`: 16/16 passed against local PostgreSQL.
- The monitor CLI exits 1 without `ROBINHOOD_CHAIN_RPC_URL`, `DATABASE_URL`, and `CREST_ACCOUNT_ADDRESS`; no live Crest Account was supplied. Database-backed replay, policy activation, immutable snapshots, reorg invalidation, and projected-versus-realized separation are proven locally, not presented as live operation.

## Task 8: Implement isolated Crest Guardian

**Files**

- Implement `apps/automation/src/{main,worker,state,validate,simulate,submit,reconcile,postconditions}.ts`
- Implement Guardian claim/receipt repository, persistence proofs, and additive PostgreSQL migrations

**Steps**

- [x] Start only through an explicit command with expected chain/account/Guardian.
- [x] Atomically claim by idempotency key and lock the signer across distinct triggers.
- [x] Refresh exact policy nonce and freeze state; repayment also requires fresh debt, reserve, vault shares/assets, and generation-appropriate withdrawal liquidity. Protective freeze requires neither Morpho debt nor vault liquidity.
- [x] Permit exactly three contract selectors.
- [x] Simulate from Guardian address.
- [x] Persist signed attempt/hash and pinned simulation block hash before broadcast or retry decisions.
- [x] Reconcile canonical receipt plus Crest/Morpho/vault post-state, including orphaned and re-mined receipts without replacing evidence.
- [x] Require debt decrease and corresponding floors/receiver/beneficiary checks.
- [x] Test duplicate delivery, restart, unseen/reverted transaction, changed policy, withdrawal constraint, no-debt freeze/repay, and signer collision.

**Acceptance**

Compromised API/monitor cannot make Guardian borrow or redirect value; duplicate triggers submit at most once.

**Local evidence (2026-09-30):** The one-shot CLI rejects missing explicit settings before RPC or signing;
the worker persists the signed hash before broadcast, never resends an uncertain attempt, verifies both
simulation and receipt block hashes around post-state reads, and isolates debtless/degraded protective
freezes from Morpho debt and vault liquidity failures. Compromised trigger action/receiver requests cannot
escape the three compiled Guardian selectors or fixed account. An isolated PostgreSQL database migrated
through the signer and receipt-ledger migrations and passed 25/25 integration checks, including concurrent
signer contention, reorg/re-mining, unsigned claim invalidation before attempt persistence, and an orphaned
receipt that blocks future claims until its signed hash is reconciled. `pnpm verify`: 14/14 workspace
typechecks and 23/23 workspace tasks passed, including 47/47 automation tests.
No live Guardian transaction was submitted: no deployed registered account, owner policy, runtime RPC,
or Guardian key was provided for this local proof. Keep live canary execution in Task 10.

## Task 9: Expose typed API and web flows

**Files**

- Extend `apps/api` (already serves `/health`, `/v1/route`, `/v1/authority` from reviewed evidence)
- Extend `apps/web` (Next.js App Router shell, brand mark, route verification screen)
- Create web screens/components from [DESIGN-SYSTEMS](./DESIGN-SYSTEMS.md)

The styling foundation — global stylesheet, theme tokens, and the shadcn/ui component base — is scaffolded
separately by the product owner. Build screens on top of it; do not introduce a second styling convention.

**Testnet-first gate (2026-10-01; wallet update 2026-10-02):** The checked-in manifest, chain client, and Tasks 1/4 fork proofs target mainnet 4663. They remain archival evidence, not authorization to transact on 46630. Approach 1 has a TLS-authenticated testnet RPC, exact TSLA-labeled/Paxos USDG Morpho market and same-core Vault V2, and a **separate finalized fork-only** supply → 0.1 USDG borrow/deposit → Guardian repay → owner exit proof in `contracts/test/RobinhoodTestnetCandidate.t.sol`. Subsequent faucet receipts and direct reads prove testnet stock-token, ETH, and USDG balances in **distinct observed wallets**, not a qualified route. Collateral issuer-registry identity, the candidate's unverified owner-controlled oracle semantics and independent price feeds remain unresolved; its vault allocates to a mock-collateral market, so no real-yield claim is permitted. See [testnet candidate evidence](./technical/INTEGRATIONS.md#testnet-candidate-status-2026-10-01). Before enabling the owner workspace, qualify those dependencies, record current liquidity and full manifest evidence, then migrate the manifest, verifier, contract proof, API, monitor, Guardian, and web chain together. Until then show the candidate as **fork-tested, not live/qualified**, and expose no owner signature path or mainnet switch.

**Recheck (2026-10-02):** Official `/rhj/assets[].id` is documented as the onchain `uid()` across chains, but the faucet TSLA, AMZN, NFLX, PLTR, and AMD testnet tokens each returned a **different UID** from the issuer registry; none has a listed 46630 deployment. The TSLA market with 110.239151 USDG shared free liquidity (head block `127410031`) is a *loan market*, not a vault, and its verified oracle uses a publicly settable `MockFeed` and fixed `MockIRM`. A newly discovered factory-created USDG Vault V2 (`0x70f5…21bc`) had 63 USDG idle and a successful read-only 0.1 USDG existing-holder withdrawal simulation, but still allocates to the `FakeWBTC` market and has not passed Crest lifecycle/yield gates. [Full evidence](./technical/INTEGRATIONS.md#issuer-oracle-market-and-vault-recheck-2026-10-02). Do not enable owner signing or treat the more liquid route as qualified.

**Sandbox decision (2026-10-02):** The owner chose "both, sandbox first", which supersedes the recheck's signing prohibition for the labeled sandbox only; the route is still not qualified. The 46630 route is registered as a labeled SANDBOX manifest (`config/deployment-manifest.46630.json`, trust tier enforced by the validator, disclosures rendered on every owner surface) and proven by `contracts/test/RobinhoodTestnetSandbox.t.sol`. Every chain-bound service binds to the active manifest. Owner signing is enabled only on the sandbox tier; 4663 stays registered, reviewed, and signing-disabled. A DEGRADED sandbox assessment permits an owner borrow only after explicit acknowledgement of its reason codes (`apps/web/src/lib/borrow-gate.ts`).

**Steps**

- [x] Disable owner signatures while the reviewed manifest remains mainnet-only; label its landing evidence as archived. Superseded for 46630 by the sandbox decision; 4663 stays signing-disabled.
- [x] Build disconnected wallet inventory with explicit asset intent.
- [x] Build combined market/vault verification with fallback. One-block live reads of market parameters, code hashes, vault asset, liquidity, and oracle; each failed read falls back to the manifest value with its reason.
- [x] Build draft → typed policy → exact calldata consequence preview.
- [ ] Build owner deploy/configure/supply/borrow-and-deploy flow. Deploy, signed staging, configure, supply, acknowledged sandbox borrow, owner repay, strategy and collateral withdrawal, and unfreeze all passed through the UI on a 46630 Anvil fork (blocks 127527696 to 127528532); closes on the live 46630 run.
- [x] Build LTV band, capital allocation, carry breakdown, realized repayment, permission, and evidence components.
- [x] Show quoted versus withdrawable vault assets.
- [x] Make additional borrow an owner approval.
- [x] Cover wrong chain, unsupported route, stale rate, vault constrained/loss, frozen, no debt, floor reached, transaction failure, and postcondition failure. Rendered with recorded fork data and mocked API states; wrong chain and revert reuse the existing chain-switch and transaction-panel paths.
- [x] Verify keyboard flow, reduced motion, and narrow viewport. Connected-owner Tab order shows a visible focus ring on every control and 390 px has no horizontal overflow; reduced motion is enforced by media-query gates because the test browser cannot emulate it.

- [x] Register the exact 46630 route as a labeled SANDBOX manifest with authenticated RPC, current liquidity, and a pinned testnet fork proof before enabling transactions.
- [x] Migrate manifest, verifier, contract proof, API, monitor, Guardian, and web to the same active 46630 route.

**Acceptance**

A first-time judge can distinguish owner versus Guardian authority, projected versus realized economics, and quoted versus withdrawable liquidity without reading docs.

## Task 10: Execute the demo scenario

**Files**

- Create `scripts/smoke-demo.ts`
- Create event-period evidence artifact

**Steps**

- [x] Inventory wallet and select one executable plus unsupported intents (fork impersonation funds the Anvil demo owner).
- [x] Open exact SANDBOX route evidence and disclosures.
- [x] Configure target band, caps, floors, net-spread minimum, and Guardian from a signed fork-owner policy.
- [x] Owner signs small supply and borrow-and-deploy on the 46630 Anvil fork only.
- [x] Observe exact debt, shares, withdrawable liquidity, and current rates as unknown/unreadable, with no APY claim.
- [x] Attempt Guardian borrow and owner over-ceiling borrow; capture both revert names and selectors.
- [x] Trigger a labeled fork-only MockFeed collateral drop.
- [x] Guardian freezes and repays from the fixed strategy; both Custos runs reconcile as verified.
- [x] Capture receipts, debt before/after, LTV/health change, persisted strategy-floor checks, and bounded-repay/debt-cap checks.
- [x] Show zero upside capacity with exact degraded reason codes; any new borrow still requires owner approval.

These checkboxes record only the Anvil 46630 fork rehearsal in `docs/evidence/demo-fork-46630.json`.
The owner was Anvil's funded development account; no live-chain transaction, independently trusted oracle,
current APY, or Task 11 testnet canary is established by this evidence.

**Acceptance**

The demo proves useful autonomous downside management without autonomous debt creation or promotional APY.

## Task 11: Testnet canary and final review

**Steps**

- [x] Reverify route, code hashes, liquidity, rates, and lifecycle state.
- [x] Run contract security/authority review and spec consistency review.
- [x] Deploy/verify source with small limits.
- [x] Execute canary owner supply → borrow-and-deploy → Guardian freeze → bounded repay → owner close.
- [x] Record exact hashes, blocks, policy, shares, debt, floors, and environment.
- [x] Test Guardian revocation, owner unfreeze, and process recovery.
- [x] Run focused Foundry, package, database, API, browser, and canary checks.
- [x] Confirm no Post-MVP A/B authority entered release.

The live canary ran on canonical Robinhood Chain Testnet 46630 (SANDBOX route) and is recorded in [`docs/evidence/canary-live-46630.json`](./evidence/canary-live-46630.json). Account [`0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75`](https://explorer.testnet.chain.robinhood.com/address/0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75) was deployed by the owner's MetaMask in block 127605219 and verified on Sourcify (creation and runtime `match`); Blockscout cannot verify it because the explorer lists solc only up to 0.8.36. `verify-deployment-manifest --manifest config/deployment-manifest.46630.json` passed online against the live relay; the monitor recorded rates, the USDG feed, and lifecycle inputs as `unreadable`, so every borrow was a degraded sandbox borrow with the owner acknowledgement. Sequence: owner supplied 1 TSLA and borrowed 10 USDG into the vault; Custos froze borrowing (tx `0x97928bd2…edf02`, block 127616213, reconcile verified); the owner tightened the LTV bands at policy nonce 2 without moving any price; the monitor assessed PROTECT at 2.796% LTV and Custos repaid 6.421094 USDG from the strategy (tx `0xe512f21c…ce90a`, block 127634675, debt 10.000047 → 3.578953); the owner repaid the rest, withdrew 3.578906 USDG of strategy and 1 TSLA, and unfroze (block 127636280), leaving zero collateral, debt, shares, and idle USDG. Checks: `forge test` 56 passed with the two pinned-fork suites skipped, `pnpm verify` green (including the database tests), and the browser path was the real owner workspace.

Revocation and recovery evidence comes from an Anvil fork of 46630, not canonical testnet. Process recovery: Custos `run --once` left run `172193ff-cac4-49ed-892a-c584106fcb7e` pending (tx `0x56a336…fa6f`), a second run on the same trigger returned `no_trigger`, and two reconciles in fresh processes both returned verified with one `transaction_attempts` row. The Guardian's `unfreezeBorrowing` reverted `OwnableUnauthorizedAccount`; the owner unfroze in tx `0x65eb0f640d8ad02b187f95bb6ed62decd0e20477a321e4ec81fba27f9fe45a75` (block 127528937). `setGuardian(0x0)` in tx `0xdcd32489db39b6626a69993813da75a60144cbbe3babdc54d73af5ba5a337a04` (block 127528942) advanced `policyNonce` 1→2; the old key's `freezeBorrowing` reverted `Unauthorized()`, Custos returned `no_trigger` on the monitor's next freeze trigger, and `doctor` failed its guardian check. `CrestAccount` exposes no envelope, permit, swap, sale, multicall, or delegatecall surface.

**Acceptance**

Canonical testnet evidence proves the route and debt reduction; if qualification fails, report the unavailable gate rather than substituting mainnet or a simulated receipt.

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
