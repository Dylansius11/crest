# Crest Development Guide

## Mission
Build Crest as a policy-controlled Stock Token borrowing product: owner-approved debt, one verified Morpho market, one fixed loan-token vault, and a Guardian that can only freeze or reduce the account's own debt.

Never present planned, forked, simulated, cached, or projected behavior as live.

## Repository map
| Path | Owns | Read or change it when |
| --- | --- | --- |
| `AGENTS.md` | Operating contract and routing | Every session, task, and commit boundary |
| `CONTEXT.md` | Kickoff orientation and corrected assumptions | Implementation kickoff, or a product decision changes |
| `docs/BUILD-PLAN.md` | Ordered execution contract, Tasks 1–11 | Before starting or closing any task |
| `docs/PRD.md`, `docs/STRATEGY.md` | Product scope | Scope, feature, or positioning questions |
| `docs/DESIGN-SYSTEMS.md` | Visual and interaction system | UI work |
| `docs/LESSONS.md` | Dated technical and workflow lessons | A new lesson is verified, or a past decision needs grounding |
| `docs/technical/ARCHITECTURE.md` | Trust boundaries and service split | Component, boundary, or data-flow changes |
| `docs/technical/SMART-CONTRACT.md` | Onchain authority and contract spec | Any contract, ABI, or permission change |
| `docs/technical/INTEGRATIONS.md` | Candidate matrix and qualification status | Chain, Morpho, vault, or API integration work |
| `docs/technical/ERD.md` | Persistence model | Schema or query changes |
| `docs/technical/TECH-STACK.md` | Exact pinned versions | Adding or upgrading any dependency |
| `docs/technical/INSTALLATION.md` | Local enablement and workflow stages | Environment or tooling setup |
| `contracts/src/CrestAccount.sol` | The single non-upgradeable account | Authority, caps, floors, repayment, withdrawal logic |
| `contracts/src/libraries/VaultV2Liquidity.sol` | Vault V2 adapter and withdrawable-liquidity math | Vault route or liquidity bounds |
| `contracts/script/DeployCrestAccount.s.sol` | Manifest-checked deployment and route validation | Deployment, evidence, or route gating |
| `contracts/test/` | Unit, invariant, and pinned-fork proofs | Every permanent behavior change |
| `config/deployment-manifest.json` + `.schema.json` | The reviewed route registry | Route, block, code hash, liquidity, or rate evidence changes |
| `scripts/verify-deployment-manifest.ts` (+ `.test.ts`) | Offline and online manifest verification | Manifest shape, gate, or finality rules change |
| `packages/domain/src/` | Branded identities, units, policy, risk, carry, Guardian states, Zod schemas | Domain vocabulary or generated schema changes |
| `packages/db/src/` | Drizzle schema, client, integration tests | Persistence changes |
| `supabase/` | Local Postgres config and migration history | Any schema migration |
| `.agents/skills/` | Project-local skills | Task routing |
| `.graphifyignore` | Corpus scope for the local knowledge graph | A path family should join or leave the graph |
| `graphify-out/` (gitignored, machine-local) | Local code-and-document graph: `graph.json`, `GRAPH_REPORT.md` | Before answering a relationship question; never commit it |

Command surface: `pnpm verify` (generate, typecheck, test), `pnpm db:reset`, `pnpm db:test`, `forge test`, `forge test --match-contract RobinhoodForkTest` for the pinned-fork proof, and `node scripts/verify-deployment-manifest.test.ts` plus `node scripts/verify-deployment-manifest.ts --rpc <url>` for manifest gates.

## Persistent instructions and focused reading
1. Read this `AGENTS.md` at session start, before every build-plan task, before every commit, and immediately after it changes. It is the persistent operating contract, not one-time orientation.
2. Read `CONTEXT.md` once at implementation kickoff; reread it only when a product decision changes or a conflict requires re-grounding.
3. Then read only the row of the repository map that the active task touches.

Conflict order: PRD owns product scope; Smart Contract owns onchain permissions; Architecture owns trust boundaries; current deployed state and reproducible runtime evidence outrank prose. Official product skills refine protocol mechanics but cannot widen Crest authority.

## Skill routing
- Route verification and all Morpho Blue work: `robinhood-chain-integration`, `borrow-integration`, and `crest-proof-engineer`.
- Exact vault discovery or integration: `earn-integration` plus `crest-proof-engineer`; first identify Vault V1, Vault V2, or another interface.
- Solidity/Foundry setup and contract work: `setup-solidity-contracts`, `develop-secure-contracts`, and `crest-contract-engineer`.
- Supabase schema, connection, RLS, or operations: user-global `supabase` and `supabase-postgres-best-practices`; Supabase Postgres is the only managed database provider.
- React/Next.js work: `vercel-react-best-practices` and `crest-frontend-polish`.
- Security and release: `crest-security-auditor`, `requesting-code-review`, and `verification-before-completion`.
- Minimal-change design decisions: `ponytail`; take the smallest change that satisfies the observed contract, and add structure only when evidence demands it.

Load only the skills relevant to the active task. Protocol-specific official skills outrank generic examples on protocol mechanics; Crest invariants still outrank any suggestion that broadens authority or scope.

## Codebase graph

`graphify-out/graph.json` is a local knowledge graph of this repository: code symbols and their
import/call edges from a deterministic AST pass, plus concept and rationale nodes from the
documents. It is gitignored and machine-local. `.graphifyignore` defines the corpus, and it
deliberately leaves out vendored skill handbooks, generated artifacts, and binary assets so
project structure is not buried under third-party material.

Reach for the graph before reading files one by one when the question is about relationships:

| Question | Command |
| --- | --- |
| How does X relate to Y? | `graphify query "<question>"` |
| What depends on X, or would break if X changes? | `graphify affected "X"` |
| What is X, in plain language? | `graphify explain "X"` |
| Shortest path between two concepts | `graphify path "A" "B"` |
| Most connected hubs | `graphify god-nodes` |
| Full report | `graphify-out/GRAPH_REPORT.md` |

Rules:
- Coverage is not uniform: the code pass covers TypeScript, JavaScript, SQL, JSON, and shell. **Solidity is not extracted at all**, so `contracts/src/CrestAccount.sol` and `contracts/src/libraries/VaultV2Liquidity.sol` have no nodes. Read contract sources directly; only their documented concepts (`docs/technical/SMART-CONTRACT.md`) appear in the graph.
- The graph is a map, not proof. A normative claim still comes from the file, test, or runtime evidence it points at; never cite graph output as deployed or measured state.
- AST-derived code facts are reliable. Document-derived concepts, INFERRED edges, and community labels are leads to verify.
- It is a snapshot of the last build. After a landed change run `graphify update .`; a post-commit hook already refreshes changed code nodes, but document changes need that command by hand.
- Never commit `graphify-out/`, and never let a stale graph override the repository file it describes.

## Documentation is part of the change
- Any work that contradicts, extends, or invalidates a document updates that document in the same change, before the commit. Never leave a document describing behavior the code no longer has.
- Contract or ABI change updates `docs/technical/SMART-CONTRACT.md` and every caller, test, and generated artifact in the same cutover.
- Boundary or service change updates `docs/technical/ARCHITECTURE.md`; schema change updates `docs/technical/ERD.md`; dependency or version change updates `docs/technical/TECH-STACK.md`; integration status change updates `docs/technical/INTEGRATIONS.md`.
- Route, block, code hash, liquidity, rate, or gate change updates `config/deployment-manifest.json`, its schema, and the verifier together.
- Completing a build-plan checklist item ticks it in `docs/BUILD-PLAN.md` immediately.
- A newly verified technical fact or durable user preference is appended to `docs/LESSONS.md` using its dated headline and bullet format, before the commit that carries the work.
- If a document and the code disagree, the reproducible runtime evidence wins and the document is corrected in that same change.

## Execution tracking and commits
- Keep all eleven `docs/BUILD-PLAN.md` tasks visible as ordered top-level todos for the entire implementation.
- Expand only the active top-level task into one child todo per checklist item and acceptance requirement; never collapse, replace, or hide future tasks.
- A blocked gate remains visible with its exact evidence-based reason. Never skip ahead past a failed market gate.
- Commit frequently: after each completed top-level task, and after every earlier slice that is independently reviewable and verified. A green narrow proof plus its document update is a commit.
- Never commit a failing or half-wired state, and keep unrelated changes out of a commit.
- Use conventional, factual messages such as `feat(contracts): enforce Guardian repayment bounds`, `test(contracts): prove pinned fork borrow lifecycle`, `chore(evidence): refresh finalized Robinhood route`, or `docs: record Robinhood finality lesson`.
- Before each commit: reread this file, run the narrow behavioral proof for the milestone, confirm affected documents were updated, and consider a new `docs/LESSONS.md` entry.

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

Use `docs/technical/TECH-STACK.md` for exact bootstrap versions. Re-check official stable releases and compatibility before changing pins; newest independently is not necessarily compatible or safer.

## Delivery
Return changed files, exact checks and observed results, assumptions, unresolved runtime gates, and one next action. Do not claim completion without behavioral evidence.

Lessons learned live in [`docs/LESSONS.md`](./docs/LESSONS.md); read it before repeating a past investigation and append to it when a new lesson is verified.
