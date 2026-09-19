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
