# Crest Lessons

Durable lessons learned while building Crest. Newest first.

Two kinds of entries live here:

- **Technical** — a verified, reusable engineering fact.
- **Workflow** — a durable user or process preference.

Entry format:

```
## YYYY-MM-DD — Headline description  (Technical | Workflow)

- What was observed, with the concrete evidence.
- Why it happens.
- The rule that now applies to future work.
```

Rules for this file:

- Append a new entry only when the lesson is newly verified and not already recorded.
- Record the rule, never the status, secrets, credentials, or speculation.
- Update it in the same change as the work that produced the lesson, before the commit.

---

## 2026-10-02 — Only a fresh-database rehearsal exercises first activation (Technical)

- The full 46630 fork rehearsal on an empty database hit, in order: no route rows (enrollment foreign-key failure), a monitor that refused the `pending_policy` account before running the indexer that is the only writer of `active`, and a Guardian submit gate pinned to chain 4663. Every unit and integration suite passed throughout, because each fixture inserted route rows and an already-active account itself.
- Fixtures that seed the state a step is supposed to produce hide the transition into that state.
- Rule: before a live run, rehearse the whole path (route registration, deploy, register, stage, configure, monitor, Custos run and reconcile, owner exit) on a fork against a freshly migrated database. Anvil mines only on transactions, so enable `evm_setIntervalMining` or the 120 s head-lag gate correctly refuses the fork head.

## 2026-10-02 - An inherited shell environment silently outranks `.env` (Technical)

- The persistent agent shell still exported `NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=4663`, `GUARDIAN_EXPECTED_CHAIN_ID=4663`, and the mainnet `DEPLOYMENT_MANIFEST_PATH` after `.env` moved to 46630. Loaders such as dotenv never overwrite an existing variable, so the web test that asserted the env-selected manifest failed and every service would have started on the wrong route. `DEPLOYMENT_MANIFEST_PATH` also resolves against the process cwd, which is the package directory under `pnpm --filter`.
- Rule: start route-bound services with explicit `NEXT_PUBLIC_ROBINHOOD_CHAIN_ID`, `DEPLOYMENT_MANIFEST_PATH` (absolute), RPC, and chain variables. Tests name the manifest they check; they never assert whichever route the environment happens to select.

## 2026-10-02 - A runtime RPC relay must not cache, and a degraded sandbox borrow needs consent (Technical)

- The fork proxy caches every non-head-relative payload. That is right for pinned forks and wrong for runtime: a cached block or receipt at an unfinalized height would hide a reorg from the canonical-receipt checks. `CREST_PROXY_CACHE=off` runs the same SNI-preserving relay without a cache for web, API, monitor, and Custos.
- On the 46630 sandbox the risk engine is DEGRADED by construction (MockFeed collateral price, no loan feed, idle-only vault), and the database forces DEGRADED capacity to zero. Per the owner's decision, a sandbox borrow may proceed only after the owner ticks an acknowledgement of the shown reason codes; a frozen account, a missing or stale (over 10 minutes) assessment, or a failed simulation still blocks it, and a reviewed route never borrows on DEGRADED.
- Rule: keep runtime relays cache-free. Encode any sandbox exception as a tested pure gate (`apps/web/src/lib/borrow-gate.ts`) that can only add a consent step, never remove a block.

## 2026-10-02 - A testnet route is a sandbox by construction, and its mock oracle has a clock (Technical)

- Robinhood's issuer registry, Chainlink's network directory, and Morpho's address page publish no 46630 deployments, so no testnet route can pass the reviewed gate. The manifest validator now fixes the trust tier per chain (4663 `reviewed`, 46630 `sandbox` with disclosures). The chosen sandbox oracle, `VigilOracle`, reverts when its session oracle judges the publicly settable `MockFeed` stale (18 h windows anchored to the market calendar), which blocks borrowing and collateral withdrawal with debt but not repayment.
- Rule: never let a chain ID choose a trust label implicitly; encode the tier in evidence and reject the mismatch. Before any sandbox owner signature, simulate the exact call, because the sandbox price can stop working on a schedule nobody controls.

## 2026-10-02 — Ticker, vault TVL, and borrowable liquidity are different proofs (Technical)

- Robinhood documents `/rhj/assets[].id` as the onchain `uid()` shared across chains for one asset. At Robinhood testnet block `127410311`, all five faucet Stock Token `uid()` values (TSLA, AMZN, NFLX, PLTR, AMD) differed from their same-ticker issuer-registry IDs, and the registry listed no 46630 deployment. A faucet transfer and verified `Stock` implementation alone do not establish registered-asset identity.
- Factory `CreateVaultV2` events revealed two exact-Paxos-USDG Vault V2 contracts absent from the explorer's source-verified vault search. The `testLPVault` had 63 idle USDG and simulated a 0.1 USDG withdrawal for an existing holder, but also allocated to a `FakeWBTC`-collateral market; another TSLA market had 110.239151 USDG of *borrowable* liquidity backed by a publicly settable `MockFeed` and a fixed `MockIRM`.
- Rule: compare onchain UID to the issuer's stable ID before using a testnet ticker; enumerate vault factories rather than trusting token names or verified-source search; gate the lending market and vault independently, keeping `totalAssets`, current normal-exit capacity, and market free liquidity separate.

## 2026-10-01 — A same-core fork route does not establish oracle trust (Technical)

- A TLS-authenticated official testnet RPC through the SNI-preserving proxy returned chain 46630 and let Foundry replay a finalized TSLA-labeled/Paxos test USDG Morpho market and USDG Vault V2. The fork proved 0.1 USDG borrow/deposit, Guardian strategy repayment, and owner exit; the market had only 1 USDG shared free liquidity at the evidence block.
- The vault's downstream position depends on a mock-collateral market, and the market oracle source and independent price feeds were not verified. The official Robinhood `/rhj/assets` registry returned 194 assets but **no 46630 deployments**, including TSLA; a verified testnet proxy named `Stock` is not enough to assert canonical issuer identity. A same-asset, same-core vault and a passing fork do not turn manually priced test tokens into an independently valued Stock Token route.
- Rule: separate fork execution compatibility from route qualification. Keep owner signatures disabled until token provenance, oracle/feed trust, current liquidity, funding, and all chain-bound clients pass a single reviewed testnet gate; never market experimental vault shares as live yield.

## 2026-10-01 — The code graph cannot see Solidity, and an incremental rebuild renames communities (Technical)

- The local `graphify` build extracts code with tree-sitter grammars for TypeScript, JavaScript, Python, Java, C/C++ and others, but ships none for Solidity. `contracts/src/CrestAccount.sol`, `contracts/src/libraries/VaultV2Liquidity.sol`, the deployment script, and the Foundry tests contribute zero nodes, and the post-commit rebuild reports `.sol` as an unclassified extension. Contract behavior reaches the graph only through `docs/technical/SMART-CONTRACT.md`.
- A post-commit rebuild re-runs clustering. When the community set changes, saved names are discarded and every community is renamed after its hub node, so a curated `graphify-out/.graphify_labels.json` must be re-mapped by member overlap and re-applied before the report is quoted.
- Rule: treat `graphify-out/` as a navigation aid for the TypeScript, SQL, and document layers only; read `contracts/src/` directly for contract behavior. After any rebuild that changes the community count, re-check that community names are still the curated ones.

## 2026-10-01 — A faucet does not qualify a borrowing route (Technical)

- The owner wallet connected to Robinhood testnet 46630 while Crest's reviewed manifest and fork proof targeted mainnet 4663. `cast chain-id` against the official testnet RPC failed TLS hostname validation on this workstation; the official Morpho address list did not identify a Robinhood testnet Blue deployment. Neither observation proves that no testnet route exists, but no 46630 AAPL/USDG market and vault have passed Crest's gate.
- Rule: qualify tokens, five Morpho market parameters, oracle, liquidity, vault, bytecode, block, and fork independently for each network. A testnet faucet provides gas, not a market. Keep mainnet evidence visible only as historical evidence and block owner signatures until every runtime component uses the same qualified testnet route.

## 2026-10-01 — Resolve manifest paths from the module, not a package command's working directory (Technical)

- `pnpm --filter @crest/api start` runs inside `apps/api`. The read-only API failed with `ENOENT` when `loadDeploymentManifest()` looked for `apps/api/config/deployment-manifest.json`; a module-relative path successfully started the service and served the recorded registry from local PostgreSQL.
- Rule: package-local commands must resolve checked-in route evidence relative to their own module, not assume the repository root is the process working directory. Keep the account API's same-origin proxy explicit and label its DB results `recorded`, never `live`.

## 2026-09-30 — A signed Guardian attempt outlives its first receipt (Technical)

- Local PostgreSQL integration verified two independent trigger claims using one signer need a partial in-flight unique index; without it, two workers can sign the same pending nonce. The reorg regression also reproduced a later claim slipping through after a conflicting run finished, while the orphan's signed hash was still unresolved.
- A canonical receipt can later be orphaned. The original signed hash, simulation block hash, receipt block hash, and postcondition block hash must remain separately attributable; keyless reconciliation can append re-mined evidence but must never auto-resend. A claimed trigger's assessment and snapshot may be invalidated before an attempt is persisted.
- Rule: claim exclusively per signer, persist the hash before send, reject new claims while any signed reorg conflict remains unresolved, and recheck the claimed evidence immediately before persisting an attempt. Retain orphaned receipt/check rows and never auto-resend.

## 2026-09-30 — Protective freezes cannot depend on vault liquidity (Technical)

- Local regressions reproduced `maxWithdrawableStrategyAssets` and `currentDebtAssets` failures aborting an otherwise valid `freezeBorrowing`; another reproduced a debtless degraded account whose monitor requested freeze but Guardian validation rejected it.
- Rule: read pinned account identity/policy/frozen state for freeze without probing Morpho debt or the vault; debt, reserve, and vault evidence are nullable until needed for repayment. A zero-debt account may still be frozen, but never repaid.

## 2026-09-30 — A replayed block hash must not reuse conflicting observations (Technical)

- Same-block polls could silently reuse position and strategy snapshot IDs when a provider returned different borrow shares or withdrawable assets; focused database regressions reproduced both collisions.
- Rule: compare every persisted position and strategy field before reusing an immutable snapshot. A conflicting read fails closed rather than attaching stale evidence to a new assessment.

## 2026-09-30 — Viem `getLogs` ignores raw `topics` (Technical)

- The Task 7 indexer passed a `topics` property to viem's public `getLogs`, but viem v2.56.8 did not forward it to `eth_getLogs`. An RPC-capturing regression reproduced empty filters, which would scan entire Morpho and vault contracts each poll.
- Rule: send `eth_getLogs` with explicit encoded topics and normalize its RPC logs with `formatLog`. Pad indexed account addresses to 32 bytes and filter the actual indexed `onBehalf` or `owner` position, not caller, sender, or receiver.

## 2026-09-29 — Vault withdrawal proceeds are not invested principal (Technical)

- In a regression, 100 deposited assets minted 100 shares; after yield accrual, an 11-asset withdrawal burned only 10 shares. Subtracting all 11 withdrawn assets falsely reported 89 principal instead of 90 for the remaining 90 shares.
- Rule: reconcile remaining cost basis from the fraction of shares burned, rounding the remaining principal up. Missing or inconsistent share history makes cost basis unknown and disables harvest; only canonical receipt-backed debt reduction counts as realized repayment.

## 2026-09-29 — Policy content identity is not the onchain policy hash (Technical)

- `compilePolicy` computes `contentHash` over canonical typed policy and intents, while `CrestAccount.PolicyConfigured` emits `policyHash = keccak256(abi.encode(PolicyConfig))`; the two hash different inputs and cannot be substituted. Task 7 registry tests verify activation against the emitted ABI hash and separately verify the stored typed content hash.
- Rule: persist both hashes independently. Only a canonical policy event whose nonce, route, and ABI policy hash match may activate a mirrored policy; an existing row with no verified ABI hash remains inactive.

## 2026-09-24 — Share rounding can overshoot a bound by one share's value (Technical)

- An independent review reproduced reverts in plans that looked exact. Morpho `borrow(x)` mints `toSharesUp` shares and debt reads back through `toAssetsUp`, so a borrow of the full room overshot target by one unit on a market at about 1e-6 assets per share, and by six units on a market at 6.9 assets per share (`1364023701` assets over `196242494` shares). Vault V2 `withdraw` burns shares rounded up and `CrestAccount` re-checks the strategy floor on the rounded-down quote, so withdrawing exactly `quoted - floor` can revert `StrategyFloorViolation`.
- The loss is bounded by one share's value rounded up: `debtAfter <= debtBefore + x + ceil((A + 1) / (S + 1e6))` on Morpho, and `quotedAfter >= quotedBefore - x - ceil((A + 1) / (S + 1))` on the vault. A fixed one-unit buffer only holds while shares are worth less than one base unit.
- Rule: every owner-borrow debt room holds back `toAssetsUp(1, totalBorrowAssets, totalBorrowShares)`, a nonzero strategy floor is guarded by one vault share's value rounded up, and every planned transaction is still simulated before signature.

## 2026-09-24 — Owner-borrow capacity uses Morpho's oracle value behind a divergence gate (Workflow)

- The owner chose Morpho's market-oracle value for LTV, health, and capacity, with Crest's feed-only value as a security check rather than the capacity basis. On the reviewed market the two differ by exactly `uiMultiplier - 1`: `divergenceWad` `566080061092436`, about 5.7 bps.
- Morpho liquidates on its own `price()`, so capacity measured on any other price would misstate the real liquidation distance; the feed-only value still catches a split or dividend that inflates a double-applied oracle.
- Rule: capacity, LTV, and health use Morpho's price; an `unexplained` composition or a divergence above `maxOracleDivergenceBps` (rounded up) is `oracle_divergence`, which zeroes capacity and freezes when the oracle trigger is on. Every surface shows both values with the double-multiplier disclosure.

## 2026-09-24 — Vault V2 deposit room comes from its caps, never `maxDeposit` (Technical)

- Vault V2 returns zero from `maxDeposit` by design. `enter()` checks `canReceiveShares` and `canSendAssets`, then calls `allocateInternal` on the liquidity adapter, which reverts when any returned id's allocation would exceed its absolute cap, or its relative cap measured against `firstTotalAssets` (total assets before the deposit lands).
- A borrow Crest deploys must fit through that allocation, so a cap-exhausted vault would revert `borrowAndDeploy` even with Morpho liquidity available.
- Rule: deposit room is the minimum over the adapter, collateral, and market ids of `absoluteCap - allocation` and, below a 100% relative cap, `totalAssets * relativeCap - allocation`. A zero absolute cap or a configured deposit gate counts as no room. The owner transaction is still simulated before signature, because interest accrued since the last allocation can use part of the room.

## 2026-09-23 — The reviewed market's oracle applies the Stock Token multiplier twice (Technical)

- At Robinhood block `70212238` the market oracle `price()` was `339917537895501582692865356`. With `SCALE_FACTOR` `1e24`, AAPL/USD `33974221248`, USDG/USD `100005000`, and `uiMultiplier()` `1000566080061092436`, feed-only gives `…065546722663` while feed times multiplier gives `…693298136`, matching to 1.3e-21. The live smoke at block `70226651` reproduced it.
- Robinhood and Chainlink both document that the AAPL/USD feed already includes the multiplier, so Morpho values this collateral about 0.057% above the total-return price today, and the gap grows with each dividend or split. The oracle is a custom `StaticOracle` with no feed getters, so only exact arithmetic reveals its composition.
- Rule: the market oracle stays Morpho's liquidation authority; Crest's own valuation never multiplies a feed price, and `classifyMarketOracle` must run on every assessment. How capacity uses the two values is the 2026-09-24 divergence-gate decision above.

## 2026-09-23 — Robinhood Chain has no sequencer uptime feed; head freshness is the substitute (Technical)

- Robinhood's oracle guide says to check a sequencer uptime feed, but Chainlink's L2 Sequencer Uptime Feeds page lists no Robinhood Chain feed and states it is no longer adding networks.
- A liveness check that looks for a nonexistent feed would either always fail or silently pass. `pinBlock` instead marks every observation `head_lag` when the head timestamp trails the wall clock beyond budget, and feed freshness is judged against the pinned block timestamp and the Chainlink heartbeat (`86400` s).
- Rule: never cite a guard that cannot exist on the chain; replace it with the strongest observable signal and name the substitution in evidence.

## 2026-09-23 — Provider docs and live payloads disagree; validate the fields you consume (Technical)

- Robinhood `/assets` returns `tradingCapabilities` as `{ market, extended, overnight } × { whole, fractional }`, not the three documented flat fields, and adds `isin`, `tokenDecimals`, and deployment flags. Morpho's vault `apy-averages` defaults to a `six_hours` lookback when none is given, and its REST vault endpoint reports fees as `null` while onchain fees are `0`.
- A strict schema on the whole payload would break on harmless additions; a loose one would accept a missing multiplier. The manifest's vault rate came from the default six-hour window, and the landing page nets it against a one-day borrow average.
- Rule: schemas are strict on consumed fields and ignore the rest; request every window explicitly and record the window the provider says it computed; prefer onchain values where an API returns `null`.

## 2026-09-23 — A caching dev proxy must never cache head-relative answers (Technical)

- `cast block-number` through the fork proxy returned `66369501` while the live head was `70211548`: `eth_blockNumber` carries no block tag, so the "no mutable tag" rule treated it as immutable.
- Rule: cache only reads pinned to an explicit block; methods whose answer moves with the head (`eth_blockNumber`, gas, nonce, receipts, filters) are never cacheable even without a tag.

## 2026-09-23 — viem rejects a mis-cased address; bind manifest addresses through `getAddress` (Technical)

- The manifest stored Morpho as `0x9D53…CbfA6…`, a mixed-case string with an invalid EIP-55 checksum. Hex comparison in the verifier accepted it; viem rejected it inside the first read.
- Rule: route binders (`morphoRouteOf`, `vaultRouteOf`) pass every manifest address through `getAddress`, so a bad checksum fails at binding with a clear error instead of inside an adapter.
## 2026-09-20 — Reveal motion must never be the only thing that makes content visible (Technical)

- A cross-breakpoint audit reported 18 of 18 reveal cells at `opacity: 0` and threw impossible contrast ratios on text that had already passed. The cause was the audit environment, not the page: the relay tab was occluded, so `requestAnimationFrame` was throttled and GSAP's `from` tweens, which apply their start state at creation (`immediateRender` defaults to true), never advanced.
- The same throttle can hit a real reader who loads the page in a background tab and returns to it, because a `once` batch only re-evaluates on a scroll, resize, or refresh event, and restoring a tab fires none of them.
- Fix in `apps/web/src/components/site/reveal-provider.tsx`: `immediateRender: false` on every scroll-triggered tween so a trigger that never fires leaves readable content instead of a hidden section, plus a `ScrollTrigger.refresh()` on `visibilitychange` and `load` so missed triggers are re-evaluated when the reader actually looks at the page.
- Rule: never let JavaScript be the only thing standing between a reader and readable text. Reveals animate from a hidden start state only once their trigger has fired, and any trigger that depends on a scroll event gets a refresh path for a restored tab.

## 2026-09-20 — tailwind-merge silently dropped colour classes next to a custom type scale (Technical)

- `bg-flame text-ink` rendered as paper text on the hero CTA. The class list reaching the DOM had no `text-ink`: `tailwind-merge` classifies an unknown `text-<token>` as a text colour, so `text-ink` and the poster size token `text-poster-base` collided, and the later class won.
- Measured result before the fix: 15 AA contrast failures across the page, including paper on flame at 3.0:1 and brand blue display text on the brand blue field at 1.4:1. After registering `poster-sm` through `poster-3xl` as a `font-size` group in `apps/web/src/lib/cn.ts`: zero failures, and size overrides still resolve correctly (`text-poster-md text-poster-lg` keeps the larger one).
- Rule: when a custom type scale lives under Tailwind's `text-` prefix, register those tokens with `extendTailwindMerge`, and treat any missing colour in the DOM as a merge conflict before hunting the component.

## 2026-09-20 — The reference site's mechanics transfer, its pixels do not (Workflow)

- The landing page was re-skinned from a marketing reference (`reference/crest-ref.mp4`): one saturated blue field, one paper field, huge condensed uppercase display, hard 1px rules, offset ink shadows, and one orange reserved for owner actions.
- Sampling tokens from the supplied artwork instead of matching the reference by eye kept the palette defensible: the brand blue is the logo plate `#006AFC`, so the theme ramp is a tint/shade scale of that single value.
- What did not transfer: the reference's illustration style and constant motion assume a consumer product. A borrowing console must keep exact amounts, sources, and blocked states visible, so texture, marquee, and reveal motion were budgeted to decoration only.
- Rule: take layout mechanics, type scale, and motion grammar from a reference; derive colors from the product's own artwork; keep every normative honesty rule in `docs/DESIGN-SYSTEMS.md` intact.

## 2026-09-20 — Name the Guardian without widening it (Workflow)

- `Custos` is now the display name for the Crest Guardian across the landing page, while the three selectors in `contracts/src/CrestAccount.sol` are unchanged.
- A character name makes automation easier to explain and easier to over-trust; a name that reads as an advisor invites the claim that it decides.
- Rule: any Guardian naming must appear beside the exact callable surface and the cannot-do list, and no MVP screen may attribute Post-MVP automation to that name.

## 2026-09-19 — Node-only code must not sit on a package's default import path (Technical)

- `next build` traced the whole repository into the server bundle because `@crest/contracts` reached `readFileSync` (Foundry artifact) and a dynamic `readFile`/`resolve` (manifest loader) through its main entry.
- Splitting the package fixed it without changing behaviour: `src/surface.ts` (pure ABI surface) and `src/manifest.ts` (pure validation rules) are importable anywhere; `src/artifact.ts` (Foundry reader) and `src/manifest-file.ts` (`loadDeploymentManifest`) stay Node-only behind the `./manifest/file` export.
- The web app now imports `config/deployment-manifest.json` directly and validates it at module load, so the reviewed route is bound at build time and a request-time path lookup cannot fail or drift.
- Rule: keep filesystem, process, and secret-touching code behind an explicit Node-only subpath export; a shared package's default path must stay importable by a browser or edge build.

## 2026-09-19 — A dev transport workaround must never become a runtime default (Technical)

- The local retrying proxy (`127.0.0.1:8599`) is the only reliable way to read pinned Robinhood state from this workstation, so proof tooling defaults to it: `pnpm fork:pin`, `pnpm fork:test`, `pnpm fork:record`, `pnpm manifest:verify`.
- Runtime components (API, monitor, Guardian) read `ROBINHOOD_CHAIN_RPC_URL` instead and have no localhost fallback; an unset or unreachable endpoint must abort, never silently degrade to a developer machine.
- This split is safe because transport is not authority: the route comes from the reviewed manifest, `CrestAccount` enforces the three Guardian selectors onchain, and every Guardian action simulates and reconciles against a canonical receipt, so a wrong or stale RPC can only stop an action, not widen one.
- Rule: keep workaround transports in dev-only scripts with an env override, document them in the installation runbook, and keep runtime endpoints explicit and fail-closed.

## 2026-09-18 — ISP DNS hijack, not a broken endpoint, blocked the official Robinhood RPC (Technical)

- `rpc.mainnet.chain.robinhood.com` resolved to `202.3.218.139` and every client (curl, Node, Foundry) failed TLS with a certificate for `internetbaik.telkomsel.com`, the local ISP filter host.
- Cloudflare DNS-over-HTTPS returned the real origin (`customer-origin.offchainlabs.com` → `172.66.147.70`); connecting to that IP with the real hostname as SNI works and answers in ~0.3 s.
- Rule: when a public RPC fails TLS with an unrelated certificate name, resolve it out-of-band before concluding the endpoint is down, and pin the resolved IP in the local proxy instead of switching to an unqualified community endpoint.

## 2026-09-18 — Robinhood Chain nodes prune state in minutes and serve proofs only at the head (Technical)

- Measured against the official node: `eth_getBalance` succeeded at head-1 through head-4096 and failed at head-16384 (~85 ms blocks, so roughly a 6–20 minute state window); `eth_getProof` succeeded at `latest` and failed at head-256.
- The community pool `rpc.ordofi.network` mixes one archive backend with pruned ones, so identical pinned reads succeeded about one attempt in twelve and took ~26 s through retries.
- Rule: pin fork proofs to a freshly refreshed block immediately before running them, anchor identity and finality to the finalized evidence block header, and re-read immutable state (code hashes, market params, vault asset) at `latest` where account proofs are actually served.

## 2026-09-18 — Exact-asset ERC-4626 exits leave sub-wei share dust (Technical)

- On the live Steakhouse USDG Vault V2, withdrawing `convertToAssets(balance)` burned round-up shares and left 9.93e11 of 9.93e20 shares, worth zero loan-token assets.
- Morpho likewise returns debt one wei above the borrowed amount because borrow shares convert back with round-up virtual-share math.
- Rule: assert protocol-reconciled quantities (`expectedBorrowAssets`, `convertToAssets`) and bound residues explicitly; never assert that an exact-asset exit zeroes the share balance.

## 2026-09-18 — Robinhood Chain finality lag makes finalized evidence unverifiable by block hash (Technical)

- Measured on chain 4663 via `rpc.ordofi.network`: 118 blocks in 10 s (~85 ms per block); `latest` 66342088 versus `finalized` 66333849, a lag of 8239 blocks.
- The EVM `blockhash` window and Arbitrum `ArbSys.arbBlockHash` both reach back only 256 blocks, which on this chain is roughly 22 seconds, while finality is roughly 12 minutes behind.
- Therefore "finalized **and** within 256 blocks" can never hold simultaneously on Robinhood Chain.
- Rule: onchain deployment validation must prove the route from live state it can actually read — code hashes, market parameters, vault asset, adapter, and liquidity — and treat block-hash evidence as a short-lived deployment-window attestation, with finality proven offchain by the manifest verifier.

## 2026-09-18 — Foundry's Arbitrum shim implements `arbBlockNumber` but not `arbBlockHash` (Technical)

- On a Robinhood Chain fork, `ArbSys(address(100)).arbBlockNumber()` returned the L2 height for 3 gas, while `arbBlockHash(uint256)` aborted with `InvalidFEOpcode`.
- `block.number` inside the fork reports the L1 block (25998181), not the L2 height, so L2 height assertions must use `ArbSys`.
- Rule: read L2 height from `ArbSys`, and obtain a canonical L2 block hash from the RPC rather than from a precompile call inside the fork.

## 2026-09-18 — `vm.rpc` returns ABI-encoded bytes while `vm.rpcJson` returns the JSON result (Technical)

- `vm.rpc("eth_getBlockByNumber", ...)` returned an ABI-encoded tuple, so `vm.parseJsonBytes32` failed with `expected value at line 1 column 1`.
- `vm.rpcJson(method, params)` returns the raw JSON string that the JSON path helpers expect.
- JSON-RPC quantity parameters reject leading zeros, so a block number must be encoded as a minimal hex quantity such as `0x3e732b6`, not a zero-padded hex string.
- Rule: use `vm.rpcJson` plus a minimal hex quantity whenever Solidity needs to read raw chain JSON.

## 2026-09-18 — The public chain-4663 RPC pool mixes archive and pruned backends (Technical)

- Repeated state reads at fixed offsets behind the head alternated between success and `historical state ... is not available`: offsets 0, 8, 256, 1024, 8239, and 16384 succeeded while 64 and 4096 failed.
- The endpoint is load balanced, so a pinned fork can start successfully and then fail mid-run when a later request lands on a pruned backend.
- `rpc.mainnet.chain.robinhood.com` is unusable from this workstation because DNS resolution for `robinhood.com` is intercepted, producing a TLS principal mismatch.
- Rule: treat pinned-fork state availability as an infrastructure gate, verify it before claiming a fork proof, and record the exact endpoint and block with the evidence.

## 2026-09-17 — Block-hash evidence must be finalized, strictly prior, and inside the 256-block window (Technical)

- EVM `blockhash` cannot return the current block or anything older than 256 blocks, so either case silently yields `bytes32(0)`.
- Accepting such evidence would let a manifest claim a block the chain cannot confirm.
- Rule: deployment evidence must be finalized, strictly earlier than the validation block, within 256 blocks, and hash-matched, or deployment fails closed.

## 2026-09-17 — Vault V2 governance can drift after a policy is bound (Technical)

- Vault V2 governance can change the liquidity adapter and its data after Crest binds a policy, and a disabled allocation can still report quoted adapter shares.
- Quoted shares therefore overstate what Crest can actually withdraw for a Guardian repayment.
- Rule: revalidate the adapter and its liquidity data before every deposit, and require every native deallocation allocation plus an exact withdrawal simulation before reporting Guardian liquidity.

## 2026-09-15 — Supabase applies timestamped migrations during start and reset (Technical)

- The local Supabase bootstrap runs the timestamp-prefixed migrations itself during `start` and `reset`.
- Re-running the same SQL through Drizzle duplicates objects and desynchronizes migration history.
- Rule: use Supabase migration history as the single runner, and keep Drizzle for schema typing and queries.

## 2026-09-14 — Robinhood L2 headers omit Cancun blob fields that Anvil requires (Technical)

- Anvil 1.8.1 rejected the pinned Robinhood header because the L2 RPC omits zero-valued Cancun blob fields.
- Downgrading the EVM version is not an option because Vault V2 relies on Cancun opcodes.
- Rule: preserve the canonical block hash and state while normalizing only the missing zero-valued header fields.

## 2026-09-14 — Morpho Vault V2 deliberately returns zero from every ERC-4626 `max*` function (Technical)

- A zero from `maxWithdraw` on Vault V2 is a deliberate interface decision, not an indication of missing liquidity.
- Treating it as unavailable liquidity would permanently disable Guardian strategy repayment.
- Rule: identify the exact vault generation first, then bound withdrawals with the vault's fresh withdrawal options and an exact simulation.

## 2026-09-13 — Morpho collateral does not earn supply yield (Technical)

- Collateral supplied to a Morpho market earns nothing; only supplied loan-token assets accrue yield.
- Presenting a collateral APY would fabricate carry that the protocol never pays.
- Rule: attribute yield only to deployed loan-token assets, and keep Morpho collateral APY at zero everywhere.

## 2026-09-13 — A broad automation key converts optimization into custody risk (Technical)

- An automation key that can call arbitrary functions can move value, regardless of what an HTTP allowlist permits.
- Offchain restrictions are advisory; only the contract ABI is enforceable.
- Rule: enforce Guardian authority in the contract itself, limited to `freezeBorrowing()`, `repayFromReserve(uint256)`, and `repayFromStrategy(uint256)`.

## 2026-09-18 — Lessons belong in a dedicated ledger, and docs ship with the code (Workflow)

- The user moved the Self Learning and Self Insight logs out of `AGENTS.md` into this file, with a dated headline and explanatory bullets.
- `AGENTS.md` is expected to stay a compact operating contract and map of the codebase.
- Rule: record lessons here, update every affected document in the same change as the code, and commit at each verified milestone.

## 2026-09-14 — High assurance without wasteful verification context (Workflow)

- The user wants strong evidence but objects to repeated or speculative checking.
- Narrow reads and persisted evidence give the same assurance at a fraction of the cost.
- Rule: use focused reads, persist verified facts in the manifest, and avoid re-verifying what the manifest already proves.

## 2026-09-14 — The complete Build Plan must stay visible (Workflow)

- The user requires all eleven build-plan tasks to remain listed for the whole implementation.
- Collapsing future tasks hides gates and makes blocked work invisible.
- Rule: keep Tasks 1–11 as top-level todos and expand only the active task into checklist and acceptance children.

## 2026-09-14 — Repository instructions stay active for the whole session (Workflow)

- The user expects `AGENTS.md` to be reread rather than treated as one-time orientation.
- Decisions recorded there change during implementation.
- Rule: reread `AGENTS.md` at every task and commit boundary, and treat `CONTEXT.md` as kickoff orientation unless a decision changes.

## 2026-09-14 — Supabase is the only managed database provider (Workflow)

- The user chose Supabase over Neon.
- A second managed provider would split migrations, connection handling, and operational knowledge.
- Rule: use Supabase-hosted PostgreSQL and its selected skills, and never introduce a parallel provider.

## 2026-09-13 — Ambitious output without speculative complexity (Workflow)

- The user wants maximum product quality while the authority surface and stack stay minimal.
- Dormant Post-MVP code and extra infrastructure add risk without adding product.
- Rule: invest in depth of proof and product polish, not in unused abstraction.

## 2026-09-13 — Repeated context must stay compact (Workflow)

- Duplicating full specifications into the operating contract makes it expensive to reread.
- Links keep one source of truth.
- Rule: link normative documents instead of restating them.
