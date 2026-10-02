# Crest Technology Stack

## 1. Decision summary

| Layer | Choice | Why |
|---|---|---|
| Workspace | pnpm workspaces + Turborepo | Shared types without custom build system |
| Web | Next.js App Router + React + TypeScript | Read dashboard plus wallet transaction boundaries |
| UI | Tailwind CSS + Radix primitives | Fast accessible implementation |
| EVM client | viem + wagmi | Typed reads, simulation, events, wallet state |
| Morpho | Verified core ABI + exact `MorphoBalancesLib`/`SharesMathLib` port for reads | Market identity/state and accrued debt match protocol rounding; Crest writes go through `CrestAccount`, never hand-built Morpho calls |
| Vault | ERC-4626 interface plus one fixed adapter only if required | Standard shares/assets/withdrawal semantics |
| Contracts | Solidity + Foundry + OpenZeppelin | Narrow account and invariant/fork proof |
| API | Hono on Node | Bounded typed HTTP surface |
| Optional policy drafting | Native Node `fetch` to Groq Chat Completions, no LLM SDK | Two fixed models; strict JSON Schema and domain/compiler validation before owner review |
| Validation | Zod + generated JSON Schema | Policy and external trust boundaries |
| Data | Supabase Postgres + Drizzle | Hosted relational audit state, bigint-safe schema, and signer-exclusive Guardian claims |
| Monitor | Node worker | Block/rate/lifecycle observations and assessments |
| Guardian | Isolated Node process with viem local signing | Three fixed debt-protection selectors; one signed hash persisted before a one-shot RPC send |
| Math | Native bigint + audited Morpho/vault semantics | Exact units and rounding |
| Tests | Vitest, Foundry, Playwright | Pure, onchain/fork, and user-flow behavior |
| Observability | Structured logs + OpenTelemetry-compatible metrics | Route/action provenance |
| Local infra | Supabase CLI local stack + Anvil | One PostgreSQL-compatible development path plus chain fork |

Pin exact versions, compiler, ABIs, deployment manifest, and rate conventions.

## 2. Repository layout

```text
crest/
├─ apps/
│  ├─ web/                   Next.js App Router shell and owner screens
│  ├─ api/                   Hono account/route API plus optional untrusted Groq draft endpoint
│  ├─ monitor/               route-drift observation; market/vault/rate assessment
│  └─ automation/            isolated Crest Guardian operator CLI
├─ packages/
│  ├─ domain/                IDs, units, states, reason codes, schemas, Observation envelope, exact decimals
│  ├─ risk/                  LTV, health, carry, capacity, action planning
│  ├─ policy/                schema, compiler, calldata diff
│  ├─ morpho/                exact market/position/accrued-debt reads
│  ├─ vault/                 Vault V2 identity/shares/capacity reads and withdrawal simulation
│  ├─ robinhood/             validated lifecycle adapter and Stock Token valuation
│  ├─ rates/                 typed APY/APR/incentive/fee observations and comparability
│  ├─ chain/                 block horizon, head freshness, feeds, code identity, call simulation
│  ├─ contracts/             generated ABI and reviewed manifest
│  └─ db/                    Drizzle schema/migrations/repositories/jobs
├─ contracts/
│  ├─ src/CrestAccount.sol
│  ├─ test/{CrestAccount,CrestAccountInvariant,RobinhoodFork}.t.sol
│  └─ script/DeployCrestAccount.s.sol
├─ config/
│  ├─ deployment-manifest.schema.json
│  ├─ deployment-manifest.json
│  └─ scenarios.v2.json
├─ docker-compose.yml
├─ pnpm-workspace.yaml
└─ turbo.json
```

The manifest contains verified route identities. It is not an unchecked address list.

## 3. Runtime and version baseline

Use the newest stable **compatible** release, not every newest tag independently. Production Node uses the newest Active LTS even when a newer `Current` line exists. Exact bootstrap pins below were verified from official release pages and npm `latest` tags on **2026-09-14**:

| Component | Exact bootstrap pin | Rationale |
|---|---:|---|
| Node.js | `24.21.0` LTS | Production-supported line; do not use Node 26 Current |
| pnpm / Corepack | `12.4.1` / `0.36.0` | Lockfile and package-manager reproducibility |
| Next.js / React / React DOM | `16.3.5` / `19.3.0` / `19.3.0` | Stable web baseline |
| TypeScript | `7.0.2` | Stable compiler; strict mode required |
| Tailwind CSS / PostCSS adapter | `4.3.3` / `4.3.3` | Stable UI build path |
| Radix UI (via shadcn/ui) | `1.6.7` | Accessible primitives; installed per component by the shadcn CLI, never as a blanket dependency |
| Motion / GSAP | `13.4.0` / `3.15.0` | Motion for React component transitions; GSAP for timeline/scroll sequences. Both obey `prefers-reduced-motion` |
| @gsap/react | `2.1.2` | `useGSAP()` hook for React GSAP setup/cleanup; registered with gsap 3.15.0 |
| Fonts (self-hosted) | `@fontsource-variable/archivo 5.3.0` / `@fontsource-variable/inter 5.3.0` / `@fontsource/ibm-plex-mono 5.3.0` | Display, body, and mono faces without third-party font requests |
| lucide-react / class-variance-authority / tailwind-merge / clsx | `1.47.0` / `0.7.1` / `3.7.0` / `2.1.1` | shadcn/ui component dependencies |
| Turborepo | `2.10.12` | Workspace task graph |
| viem / wagmi | `2.56.8` / `3.7.7` | EVM reads, simulation, wallet state |
| TanStack Query | `5.102.8` | wagmi-compatible async cache |
| Morpho Blue SDK / morpho-ts | `6.7.0` / `2.11.1` | Official market entities, ABI, and time/math helpers |
| Hono / Node adapter | `4.13.8` / `2.1.1` | Typed API runtime |
| Zod | `4.6.4` | Trust-boundary schemas |
| Drizzle ORM / Kit / Postgres.js | `0.45.2` / `0.31.10` / `3.4.9` | PostgreSQL schema, migrations, driver |
| Vitest / Playwright | `5.0.0` / `1.63.0` | Pure/integration and browser checks |
| Supabase CLI | `2.117.0` | Project-local local-stack, schema, and project-linking CLI |
| Hosted PostgreSQL | Supabase project version | Record the actual project major/extensions at provisioning; do not assume local `18.6` |
| Solidity / Foundry | `0.8.37` / `1.8.1` | Stable compiler and EVM toolchain |
| OpenZeppelin Contracts | `5.6.1` | Reviewed primitives; import minimally |
| OpenTelemetry API | `1.9.1` | Stable telemetry interface |

Pin JavaScript packages without range prefixes in the lockfile-backed workspace. Pin Foundry by release/commit and Solidity in `foundry.toml`. Before accepting any refresh, run install, typecheck, build, focused tests, ABI diff, and pinned-fork smoke flow together; “latest” is not evidence of compatibility or safety.

`@crest/automation` reuses the pinned `viem 2.56.8`, `drizzle-orm 0.45.2`, and workspace
`@crest/chain`, `@crest/contracts`, `@crest/db`, `@crest/domain`, `@crest/morpho`, `@crest/policy`,
and `@crest/vault` packages. Task 8 adds no new external package or version pin. The signer is an
ephemeral viem `PrivateKeyAccount`, not a generic wallet executor or additional service.

Primary version sources: [Node releases](https://nodejs.org/en/about/previous-releases), [npm registry](https://www.npmjs.com/), [Supabase CLI releases](https://github.com/supabase/cli/releases), [PostgreSQL versioning](https://www.postgresql.org/support/versioning/), [Solidity releases](https://github.com/argotorg/solidity/releases), and [Foundry releases](https://github.com/foundry-rs/foundry/releases).

Optional policy drafting adds **no package**: Node's native `fetch` calls `https://api.groq.com/openai/v1/chat/completions` using server-only `POLICY_LLM_API_KEY`. Fixed primary `openai/gpt-oss-120b` and fallback `qwen/qwen3.8-27b` both support strict JSON Schema output; GPT-OSS uses `reasoning_effort: low`, Qwen uses `reasoning_effort: none`, and both use `reasoning_format: hidden`. The API validates model output and runs the existing `@crest/policy` compiler. This provider never runs in `@crest/risk`, monitor, Guardian, or the contract. [Groq models](https://console.groq.com/docs/models), [structured outputs](https://console.groq.com/docs/structured-outputs), [reasoning](https://console.groq.com/docs/reasoning).

### 3.1 Rust decision

**Rust is not required for Crest MVP.** Crest already needs TypeScript for the web/services and Solidity for EVM custody. A third implementation language adds build, deployment, review, and cross-language parity cost without removing the dominant risks.

Foundry is implemented in Rust, but Crest consumes its released binaries; contributors do not need a Rust compiler or Cargo for the MVP.

Rust is not a security feature by itself. Its memory-safety model can reduce classes of bugs in Rust code, but it does not solve authorization errors, oracle misuse, economic assumptions, stale data, compromised signing keys, unsafe external contracts, or faulty Solidity invariants.

Potential later uses, each gated by evidence:

1. **Risk/scenario compute service:** only when profiling shows the pure bigint/rational TypeScript engine misses a measured latency or throughput SLO.
2. **Isolated signing service:** only when a reviewed Rust/HSM stack provides a concrete operational advantage over the already least-power Node Guardian.
3. **Stylus contract:** only in a new audited contract version when an Arbitrum benchmark proves material gas/compute savings for logic that cannot stay offchain.

Adoption requires a benchmark, an explicit process/API boundary, shared golden test vectors, deterministic TypeScript/Rust parity, new deployment runbooks, and a security review. Do not add Rust “for performance” or “for security” without those proofs.

Local infrastructure remains the Supabase CLI local stack plus Anvil. The deployed database is Supabase Postgres; Supabase Auth, Realtime, Storage, Edge Functions, and Data API are not MVP dependencies unless the PRD changes. Docker is required by the local Supabase stack. No Rust/Stylus toolchain, Redis, Kafka, or custom oracle is in MVP.

## 4. Numeric and identity types

```ts
type Address = `0x${string}`;
type Hash = `0x${string}`;
type MarketId = Hash & { readonly __brand: "MarketId" };
type VaultId = `${bigint}:${Address}` & { readonly __brand: "VaultId" };
type BaseUnits = bigint & { readonly __brand: "BaseUnits" };
type Shares = bigint & { readonly __brand: "Shares" };
type Wad = bigint & { readonly __brand: "Wad" };
type BasisPoints = bigint & { readonly __brand: "BasisPoints" };
type BlockNumber = bigint & { readonly __brand: "BlockNumber" };
type Health =
  | { kind: "no_debt" }
  | { kind: "finite"; wad: Wad };
type Rate = {
  value: bigint;
  scale: bigint;
  convention: "apr-simple" | "apy-compounded";
  source: string;
  observedAt: string;
  status: "normal" | "degraded" | "unknown";
};
```

Rules:

- token/market/vault values remain bigint;
- API/database amounts use decimal strings;
- every price/rate has explicit scale and source;
- never use one generic `number` for multiplier, feed decimals, WAD, APY, token decimals, or shares;
- projected carry and realized debt repayment are different domain types.

## 5. Deep package interfaces

### `@crest/risk`

```ts
export function assessPosition(input: RiskInput): RiskAssessment;
export function planGuardianAction(input: ActionInput): GuardianAction | null;
export function estimateCarry(input: CarryInput): CarryEstimate;
export function parseScenarioSet(raw: unknown): ScenarioSet;
```

This module owns LTV, health, target debt, borrow capacity, repay capacity, spread, stress scenarios, and state rules. No I/O, clock, or LLM: `assessPosition` is deterministic, and `inputHash` is keccak256 of `canonicalJson({ engineVersion, input })` under `RISK_ENGINE_VERSION`.

- **Screening.** Every input is re-checked against the active policy's own freshness budgets (head lag, feed age, index lag, and Robinhood response ages against the pin's wall clock), against the pinned block (`block_skew`), and against the route identities (`identity_mismatch`, and `conflict` when the onchain policy nonce differs). Reasons are only added.
- **Oracle gate.** Capacity, LTV, and health use Morpho's `price()`. Crest's feed-only price (collateral feed over loan feed, no multiplier) is shown beside it. An `unexplained` composition, or a divergence above `maxOracleDivergenceBps` (rounded up), is `oracle_divergence`: zero capacity, DEGRADED inside the band, and a freeze when the oracle trigger is on.
- **Owner-borrow capacity** is the minimum of the remaining debt ceiling, room to target LTV, Morpho liquidity, remaining strategy cap, and the vault's deposit room under every Vault V2 cap on the liquidity adapter's ids. Both debt rooms hold back one borrow share's value rounded up (`toAssetsUp(1, totalBorrowAssets, totalBorrowShares)`), because Morpho rounds minted borrow shares up and reads debt back rounded up. It is zero when borrowing is frozen, any source is degraded (including a strategy that cannot currently withdraw what it holds), the rates cannot be netted, or the marginal spread is below policy.
- **State precedence.** No valuation is DEGRADED; then CRITICAL, PROTECT, and EXIT_YIELD (vault loss, or a negative marginal spread even on stale but comparable rates), which stay available on degraded input; then DEGRADED; then HARVESTABLE (a surplus over the reconciled cost basis) and UPSIZE_AVAILABLE.
- **Planner.** Freeze first when required and not yet frozen; otherwise one repayment from the source covering the most, preferring the reserve on a tie. Exit and harvest use the strategy. Capacities already include floors, the per-action cap, the debt, and currently withdrawable vault assets; a nonzero strategy floor is raised by one vault share's value rounded up, because the contract re-checks it on the quote after the vault burns shares rounded up. Repayment sources count only when their reasons are facts (`vault_loss`, `withdrawal_constrained`), never doubts such as `stale`, `block_skew`, or `route_drift`. A repayment is planned only from this account's reads at the pinned block under the policy nonce the contract holds; otherwise only a freeze can be planned.
- **Scenarios** (`config/scenarios.v2.json`, `illustrative`) are adverse by schema and rerun the same pass; stressed capacity is also clamped to the live capacity.

### `@crest/policy`

```ts
export function routeContextOf(
  manifest: DeploymentManifest,
  deployment: { account: Address; owner: Address },
): VerifiedRouteContext;
export function compilePolicy(
  draft: unknown,
  route: VerifiedRouteContext,
): { ok: true; policy: CompiledPolicy } | { ok: false; issues: string[] };
export function toConfigurationCall(
  policy: CompiledPolicy,
): PreparedOwnerTransaction;
```

The route (exact `MarketParams`, vault, token decimals, feeds) comes only from a `full_route` manifest; a draft that supplies one is rejected. A draft carries owner limits and asset intents: exactly one `PROTECT_AND_BORROW` on the verified market and one `EARN_STABLE` on the verified vault. The domain `policyV2Schema` is strict, so unknown fields (for example a Guardian borrowing limit) fail compilation. Freshness budgets default to `DEFAULT_FRESHNESS` and may be tightened. `CompiledPolicy.policyHash` is `keccak256(abi.encode(PolicyConfig))`, the value `PolicyConfigured.policyHash` carries; `contentHash` is keccak256 of the canonical typed policy and intents. A test pins the `configure` selector and calldata to the generated contract ABI. No LLM path exists; natural language may only ever draft input to `compilePolicy`.

### `@crest/morpho`

```ts
export interface MorphoPort {
  getMarket(params: MarketParams, block: bigint): Promise<MarketObservation>;
  getPosition(account: Address, params: MarketParams, block: bigint): Promise<PositionObservation>;
  prepareOwnerBorrowAndDeploy(input: BorrowInput): Promise<PreparedOwnerTransaction>;
}
```

Use official SDK where it matches the deployed version. Recompute critical identity/math rather than wrapping every SDK call.

### `@crest/vault`

```ts
export interface VaultPort {
  verify(vault: Address, loanToken: Address, block: bigint): Promise<VerifiedVault>;
  observe(account: Address, vault: Address, block: bigint): Promise<VaultObservation>;
  simulateWithdraw(input: WithdrawInput): Promise<WithdrawalSimulation>;
}
```

One production ERC-4626 adapter and one deterministic test adapter justify the seam. Do not expose routing.

### `@crest/rates`

```ts
export interface RatePort {
  observeBorrowRate(market: MarketId): Promise<RateObservation>;
  observeVaultRate(vault: VaultId): Promise<RateObservation>;
}
```

It normalizes convention/source/freshness; it never labels a projection realized.

### `@crest/robinhood`

```ts
export interface RobinhoodSignals {
  getAssets(): Promise<AssetRegistryObservation>;
  getPrice(symbol: string): Promise<UnderlyingPriceObservation>;
  getCorporateActions(): Promise<CorporateActionObservation[]>;
}
```

It never returns Morpho collateral value or capacity.

## 6. Smart-contract stack

- Foundry for build, unit, fuzz, invariant, fork, and deploy.
- OpenZeppelin `Ownable2Step`, `SafeERC20`, and `ReentrancyGuard` only where useful.
- Verified Morpho interfaces/math.
- OpenZeppelin or minimal verified ERC-4626 interface; do not import a whole vault framework to make three calls.
- Slither/static analysis when available.
- Source/bytecode verification after deployment.

No proxy, generic account, Safe module, ERC-4337, Permit2, DEX adapter, flash loan, or Stylus in MVP.

## 7. Why a custom account

`CrestAccount` has an owner surface and exactly three Guardian methods:

```text
freezeBorrowing()
repayFromReserve(uint256)
repayFromStrategy(uint256)
```

Contract structure—not an HTTP allowlist—prevents Guardian debt creation and value extraction.

## 8. Monitor and Guardian

### Monitor

- coherent block-scoped Morpho/vault reads;
- low-rate cache-aware Robinhood/rate observations;
- pure risk-and-carry assessment;
- transactional trigger creation;
- no signing key.

### Guardian

- separate environment and secret;
- database lease on trigger;
- allowlisted account plus selector defense-in-depth;
- fresh state and simulation;
- nonce serialization;
- canonical receipt reconciliation;
- debt/floor/receiver postconditions.

Do not expose Guardian through a generic HTTP route.

## 9. Database coordination

Supabase Postgres owns observations, policy versions, assessments, triggers, leases, attempts, receipts, and postconditions. Drizzle schema and migrations remain the single repository source; do not create a parallel migration convention.

One Guardian worker is enough. Add replicas only after testing lease expiry, nonce serialization, and recovery. No Redis/Kafka.

## 10. UI rules

- Follow [DESIGN-SYSTEMS](../DESIGN-SYSTEMS.md).
- Server-render read-only data where practical; wallet transaction steps are client components.
- Use SVG/HTML charts initially.
- Use semantic tables/forms before grids/form frameworks.
- Transaction previews show route, target, selector, amount, share bounds, simulation block, and policy effect.
- “Borrow more” is an owner approval, never a Guardian state in MVP.

## 11. Testing stack

| Surface | Tool | Critical behavior |
|---|---|---|
| Policy/risk/carry | Vitest/property tests | LTV boundaries, rate convention, degradation, projected/realized separation |
| Crest Account | Foundry unit/fuzz/invariant | roles, caps, floors, fixed route, receiver, debt decrease |
| Morpho/vault route | Pinned Foundry fork | borrow-and-deploy, maxWithdraw, partial strategy repay, owner exit |
| Adapters/database | Vitest + Supabase Postgres | schema validation, reorg, idempotency, policy activation |
| Guardian | Anvil/fork integration | duplicate trigger, nonce, receipt, postconditions, no borrow |
| Web | Playwright | inventory → policy → owner borrow → Guardian evidence |

Mocks cover failure boundaries; they do not prove the claimed live route.

## 12. Deployment topology

```text
Vercel             apps/web (Next.js); /v1/* and /rpc rewrite to the VPS API origin
Shared VPS         Docker Compose project `crest`, image node:24.21.0-bookworm-slim + pnpm 12.4.1
  crest-relay-1    scripts/rpc-retry-proxy.ts, cache off, testnet RPC upstream (128 MiB)
  crest-api-1      apps/api on :8787, no host port (256 MiB)
  crest-monitor-1  apps/monitor, no signing key (256 MiB)
  crest-custos-1   apps/automation watch, the only container with the Guardian key (256 MiB)
  vps-caddy-1      shared Caddy (another project); crest-api.43-129-38-115.nip.io -> API, /rpc -> relay
Supabase Postgres  session pooler, sslmode=verify-full against the pinned Supabase root CA
Robinhood Chain RPC, Robinhood lifecycle/rate sources
```

`node deploy/vps/deploy.ts` ships `git archive HEAD`, builds one image per commit on the VPS, swaps services only after their health checks pass, and keeps three releases for `--rollback`. Secrets live in `~/crest/{api,monitor,custos}.env` (mode 600), outside every release. Automation starts only after manifest and contract verification. Owner remains a user-controlled wallet.

## 13. Environment separation

- `local`: Anvil + mock Morpho/vault/lifecycle/rate fixtures + Supabase CLI local stack.
- `fork`: pinned Robinhood state; read-only live APIs optional.
- `testnet`: only when exact required contracts exist.
- `mainnet-canary`: verified manifest, small limits, separate Guardian.
- `mainnet`: only after canary proof.

Every screenshot/record labels environment and block/time.

## 14. Rejected choices

| Rejected | Reason |
|---|---|
| Basket collateral token | Wrapping creates no market, oracle, or liquidity |
| Generic lifecycle API as product | Integrators can add basic halts; user-facing debt loop has stronger value |
| Dynamic best-yield router | Expands venue, approval, liquidity, and trust surface |
| Autonomous additional borrow in MVP | Debt-increasing authority conflicts with least-power claim |
| Generic smart account | More authority and integration than three Guardian methods need |
| Upgradeable proxy | Governance/storage/audit risk |
| Autonomous collateral sale | Separate later threat model |
| REST price as oracle | Wrong authority |
| Kafka/Redis/timeseries store | PostgreSQL and one worker suffice |
| Stylus | No measured advantage |

## 15. Post-MVP technical boundary

Post-MVP A is a new audited account supporting one EIP-712 borrow envelope. Post-MVP B coordinates multiple one-market accounts and independently qualified strategies.

Do not add dormant envelope, swap, multi-vault, or collateral-sale code to MVP.

## 16. Dependency policy

- one responsibility per runtime dependency;
- pin official versions and deployment compatibility;
- generate ABI/types and reject drift;
- verify vault interface instead of trusting the ERC-4626 label;
- keep external calls inspectable;
- no dependency may introduce arbitrary Guardian execution.
