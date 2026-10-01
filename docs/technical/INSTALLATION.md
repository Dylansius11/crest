# Crest Installation and Development Enablement

Build stages 1–8 are implemented and proven locally; a live monitor or Guardian requires a deployed Crest Account, a registered exact route, a canonically activated owner policy, and a reviewed runtime RPC. See [BUILD-PLAN](../BUILD-PLAN.md) for later stages.

## 1. Workflow

| Stage | Required evidence |
|---|---|
| Product scope | Approved PRD, strategy, vocabulary, and non-goals |
| Route research | Verified market-and-vault deployment manifest |
| Contract | Red-green unit/fuzz/invariant behavior |
| External integration | Pinned fork and read-only live observations |
| UI | Actual browser flow with wallet/error states |
| Completion | Fresh focused checks plus canary/fork proof |
| Review | Contract authority, vault receiver, APY copy, and docs consistency |

Runtime/fork evidence outranks comments. Every contract/interface change updates all consumers.

## 2. Workstation prerequisites

Verify:

```bash
node --version
corepack --version
forge --version
cast --version
anvil --version
docker --version
git --version
```

Baseline verified on 2026-09-14; [Tech Stack](./TECH-STACK.md) is authoritative:

- Node.js `24.21.0` LTS;
- Corepack `0.36.0` with repository `packageManager: pnpm@12.4.1`;
- Foundry `1.8.1` and Solidity `0.8.37`;
- project-local Supabase CLI `2.117.0`;
- Git;
- Docker for the Supabase CLI local stack;
- no standalone local PostgreSQL install and no Rust/Stylus dependency in MVP.

Use official Foundry installation instructions: <https://getfoundry.sh/introduction/installation/>.

On Windows, use one supported shell/environment and avoid multiple Foundry installations on PATH.

## 3. Developer CLIs

| CLI or surface | Crest use | Rule |
|---|---|---|
| Corepack / pnpm | Reproducible workspace, scripts, and project-local tools | Use the lockfile and `packageManager`; do not mix npm/yarn installs |
| Supabase CLI | Local Supabase stack and hosted-project linking | Install project-local at `2.117.0`; discover commands with `--help` |
| `forge` | Solidity build, unit/fuzz/invariant/fork tests, deployment scripts | Pin Foundry and Solidity; prefer reproducible scripts |
| `cast` | Chain ID, bytecode, calls, receipts, logs, and Blockscout verification inputs | Never paste production private keys or credential-bearing RPC URLs |
| `anvil` | Manifest-pinned Robinhood Chain fork | Fork exact block/hash evidence; do not call a fork live |
| `chisel` | Throwaway Solidity/EVM calculations | Optional; never use REPL output as deployment evidence |
| Blockscout API/UI | Source, address, and transaction discovery/cross-check | Direct RPC and canonical receipt remain authoritative |

Useful discovery commands:

```bash
pnpm supabase --help
pnpm supabase --version
pnpm supabase status
cast chain-id --rpc-url \"$ROBINHOOD_CHAIN_RPC_URL\"
cast block-number --rpc-url \"$ROBINHOOD_CHAIN_RPC_URL\"
cast code <address> --rpc-url \"$ROBINHOOD_CHAIN_RPC_URL\"
forge --version
```

Robinhood Chain endpoints:

```text
Mainnet RPC:       https://rpc.mainnet.chain.robinhood.com
Mainnet explorer:  https://robinhoodchain.blockscout.com
Testnet RPC:       https://rpc.testnet.chain.robinhood.com
Testnet explorer:  https://explorer.testnet.chain.robinhood.com
Testnet faucet:    https://faucet.testnet.chain.robinhood.com
```

There is no required Robinhood-specific CLI and no separate official Morpho CLI. Use standard EVM tools plus `@morpho-org/morpho-sdk`, its Blue packages, and current Morpho APIs. Public RPCs are rate-limited; production/demo reliability requires a reviewed provider without weakening chain-ID, block, or code-hash verification.

## 4. Project bootstrap

From the implementation root:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm supabase start
pnpm db:migrate
pnpm generate
pnpm verify
forge test
```

Lockfiles, remappings, and repository scripts are authoritative. Do not float Solidity dependencies after pinning.

## 5. Contract dependencies

Minimum:

- OpenZeppelin Contracts for ownership, safe ERC-20 operations, and reentrancy protection;
- official Morpho interfaces/math compatible with the verified deployment;
- a minimal ERC-4626 interface or OpenZeppelin interface only;
- one fixed adapter only if the selected vault is not compatible.

Before adding Morpho or vault packages:

1. identify deployed address/version from current source and bytecode;
2. locate tagged source/interface;
3. compare ABI selectors and behavior;
4. pin tag/commit;
5. verify exact market ID or vault `asset()`;
6. run pinned-fork deposit/withdraw/repay behavior.

Never copy an ABI or address from an unverified gist.

## 6. JavaScript dependencies

Install exact versions through the lockfile-backed workspace:

```bash
pnpm add next@16.3.5 react@19.3.0 react-dom@19.3.0
pnpm add viem@2.56.5 wagmi@3.7.7 @tanstack/react-query@5.102.8
pnpm add @morpho-org/blue-sdk@6.7.0 @morpho-org/morpho-ts@2.11.1
pnpm add hono@4.13.7 @hono/node-server@2.1.1 zod@4.6.4
pnpm add drizzle-orm@0.45.2 postgres@3.4.9 @opentelemetry/api@1.9.1
pnpm add radix-ui@1.6.7
pnpm add -D typescript@7.0.2 turbo@2.10.12 drizzle-kit@0.31.10
pnpm add -D vitest@5.0.0 @playwright/test@1.63.0
pnpm add -D tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3
pnpm add -D supabase@2.117.0
```

These are a compatible bootstrap candidate, not permission to skip install/typecheck/build/fork verification. Refresh the complete set from official stable sources rather than floating one package independently.

Do not add a routing, agent, automation, or vault SDK when viem plus the verified ABI covers the required calls.

## 7. Environment contract

Commit `.env.example`, never credentials.

```dotenv
# Public
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=4663
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# Server only
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
DIRECT_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
SUPABASE_PROJECT_REF=
ROBINHOOD_CHAIN_RPC_URL=
ROBINHOOD_API_BASE_URL=https://api.robinhood.com/rhj
CREST_ACCOUNT_ADDRESS=
MONITOR_INTERVAL_MS=60000

# Guardian process only
GUARDIAN_EXPECTED_CHAIN_ID=4663
GUARDIAN_PRIVATE_KEY=
GUARDIAN_EXPECTED_ADDRESS=
GUARDIAN_ALLOWED_ACCOUNT=

# Verified route
DEPLOYMENT_MANIFEST_PATH=./config/deployment-manifest.json

# Optional policy drafting
POLICY_LLM_PROVIDER=disabled
POLICY_LLM_API_KEY=

LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=
```

Rules:

- Guardian key exists only in Guardian environment/secret manager.
- No owner private key environment variable.
- No private RPC or signer data in client variables.
- Contract/token/Morpho/vault/oracle addresses come from reviewed manifest.
- Test keys are disposable Anvil keys only.
- Never log credential-bearing URLs.

## 8. Supabase Postgres

Supabase is the deployed PostgreSQL provider. Drizzle remains the schema/migration source and the application uses Postgres.js through Drizzle; do not add Supabase Auth, Realtime, Storage, Edge Functions, or browser Data API access without a product requirement.

The Supabase CLI is a pinned project dev dependency rather than a machine-global prerequisite:

```bash
pnpm supabase init
pnpm supabase start
pnpm supabase status
pnpm db:migrate
```

Run `init` once and commit `supabase/config.toml`; do not overwrite an existing project configuration. The local stack requires Docker and exposes PostgreSQL at `127.0.0.1:54322` by default. Repository scripts, not ad hoc dashboard edits, own schema changes.

For hosted environments:

- copy exact connection strings from the Supabase **Connect** dialog; never derive pooler hosts;
- use the appropriate pooled `DATABASE_URL` for the runtime topology;
- use `DIRECT_URL` for migrations, dumps, and other single-session administration;
- transaction-pooler clients use `max: 1`, `prepare: false`, and required SSL;
- never expose database passwords, direct URLs, secret/service-role keys, or Guardian credentials to the browser;
- record the hosted PostgreSQL major, required extensions, region, pooling mode, and migration result as deployment evidence.

No Neon, Redis, or message broker. One Guardian worker plus Supabase Postgres leases/idempotency is MVP.

## 9. Deployment manifest

The manifest includes:

```json
{
  "schemaVersion": "2.0.0",
  "chain": {
    "chainId": 4663,
    "verifiedBlock": "...",
    "verifiedBlockHash": "0x...",
    "verifiedAt": "...",
    "source": "..."
  },
  "morpho": {
    "address": "0x...",
    "codeHash": "0x...",
    "source": "..."
  },
  "collateralToken": {
    "address": "0x...",
    "providerUid": "0x...",
    "decimals": 18,
    "codeHash": "0x..."
  },
  "loanToken": {
    "address": "0x...",
    "decimals": 6,
    "codeHash": "0x..."
  },
  "market": {
    "id": "0x...",
    "oracle": "0x...",
    "irm": "0x...",
    "lltvWad": "...",
    "availableLoanAssets": "..."
  },
  "yieldVault": {
    "address": "0x...",
    "asset": "0x...",
    "interfaceKind": "erc4626",
    "codeHash": "0x...",
    "manager": "...",
    "maxDepositAssets": "...",
    "maxWithdrawAssets": "...",
    "source": "..."
  }
}
```

Ellipses are schema examples only. A shipped manifest contains current verified values.

The verifier recomputes market ID, confirms code and vault asset, and reads current market/vault state.

## 10. Fork setup (verified runbook)

Robinhood Chain RPC access has two verified defects; both are already handled by tooling in this repository, so
follow this runbook instead of rediscovering them.

1. **The official endpoint may be DNS-hijacked locally.** On the Telkomsel network `rpc.mainnet.chain.robinhood.com`
   resolves to a filter host (`202.3.218.139`, certificate `internetbaik.telkomsel.com`) and every client fails TLS.
   Resolve the real origin out-of-band and pin it:

   ```bash
   curl -sS -H 'accept: application/dns-json' \
     'https://cloudflare-dns.com/dns-query?name=rpc.mainnet.chain.robinhood.com&type=A'
   # customer-origin.offchainlabs.com -> 172.66.147.70
   ```

2. **Nodes prune state within minutes.** `eth_getBalance` is served roughly from head to head-4096 (~6–20 minutes at
   85 ms blocks) and `eth_getProof` only at `latest`. Community pools such as `rpc.ordofi.network` mix one archive
   backend with pruned ones, so pinned reads succeed about one attempt in twelve.

Run the proof:

```bash
CREST_UPSTREAM_IP=172.66.147.70 pnpm fork:proxy     # retrying, disk-cached JSON-RPC proxy on 127.0.0.1:8599
pnpm fork:pin                                       # repins forkProof to a fresh block (head-256) and revalidates
pnpm fork:test                                      # forge test --match-contract RobinhoodForkTest
pnpm fork:record                                    # promotes the manifest gate from the measured lifecycle
pnpm manifest:verify                                # local rules plus onchain drift check
```

The proxy pins the upstream IP while keeping the real TLS hostname as SNI, retries the pruned-backend error, and
caches immutable block-pinned reads, so reruns finish in under a second. Foundry also caches fork state on disk.

Fork prerequisites:

- `forkProof.blockNumber` refreshed immediately before the run (state ages out in minutes);
- identity and finality still anchored to the finalized `evidence.block`;
- market and vault exist at that block;
- test funding/impersonation is local and labeled;
- no production key loaded.

A fork proves compatibility at one state, not future rates or liquidity.

## 11. Fixtures

### Robinhood

- active deployment;
- halt;
- pending multiplier;
- processed corporate action;
- unknown/missing field;
- stale/timeout/rate limit.

### Vault

- normal deposit/withdraw;
- rounding/slippage;
- deposit cap;
- partial/zero `maxWithdraw`;
- pause;
- share loss;
- reentrancy/malicious callback mock.

### Rates

- APR versus APY convention;
- base versus incentive;
- fee-inclusive versus gross;
- stale/conflicting/unknown source;
- very small debt denominator.

Fixtures test adapters. They are never live demo evidence.

## 12. Canonical commands

```bash
pnpm --filter @crest/web dev            # Next.js owner surface on :3000
pnpm --filter @crest/api start          # read-only reviewed route and recorded-account API on :8787
pnpm --filter @crest/monitor observe:once   # one confirmed-block assessment, no signing
pnpm --filter @crest/automation doctor  # Guardian authority check; never signs
pnpm --filter @crest/automation exec node src/main.ts run --once --trigger-id <trigger-id>
pnpm --filter @crest/automation exec node src/main.ts reconcile --run-id <run-uuid>
pnpm db:migrate
pnpm generate
pnpm verify
pnpm manifest:verify
pnpm smoke:adapters --borrower <address> --vault-holder <address> [--rpc <url>] [--doh]
forge fmt --check
forge build
forge test
forge test --match-contract CrestAccountInvariantTest
```

The API needs `DATABASE_URL` and starts with the repository's reviewed manifest, even when launched from `apps/api`. The web account screen forwards only `/v1/accounts` and `/v1/accounts/:address/position` through the Next.js same-origin proxy to `CREST_API_URL` (default `http://127.0.0.1:8787`). Start the API separately to inspect recorded positions; an unavailable API never becomes live data. No wallet is needed for address lookup; wallet actions additionally require a recorded account and direct onchain owner/bytecode checks.

`@crest/monitor` requires `ROBINHOOD_CHAIN_RPC_URL`, `DATABASE_URL`, and `CREST_ACCOUNT_ADDRESS`; the address must
already have an active registry row and a registered owner policy. The indexer activates that policy only when
its `policy_hash` matches a canonical `PolicyConfigured` event on the reviewed route. The poll indexes events and
reads the account, market, vault, oracle, rates, and lifecycle, then stores immutable snapshots, an assessment,
and at most one idempotent Guardian trigger. No account is fabricated or registered by a read-only poll. Use
`pnpm --filter @crest/monitor start` for continuous polling (`MONITOR_INTERVAL_MS`, default 60000 ms); `--once`
exits on any registry, route, or RPC failure. A read-only monitor must not receive the Guardian key.

`@crest/automation doctor` requires `ROBINHOOD_CHAIN_RPC_URL`, `DATABASE_URL`, `GUARDIAN_EXPECTED_ADDRESS`,
and `GUARDIAN_ALLOWED_ACCOUNT`. It checks the active registered account bytecode, exact Morpho/vault/token
code hashes, vault asset, current policy/route, and qualified manifest at one fresh block; it never loads
a key or signs. A degraded vault or Morpho read prevents a full-route attestation.
`run --once` also requires
`GUARDIAN_EXPECTED_CHAIN_ID=4663`, `GUARDIAN_PRIVATE_KEY`, and an explicit detected trigger ID.
`reconcile --run-id` requires the same route, chain, account, Guardian, RPC and database settings, but
**not** the key. Keep the key only in the isolated Guardian process, never in the monitor.
`run` signs at most one action; `pending` or `uncertain` requires operator inspection of the persisted hash
and explicit keyless reconciliation. Never rerun a claimed trigger, replace its nonce, or resend uncertain bytes.
`failed` or `no_pending` exits nonzero. An unseen hash stays pending, not \"dropped\" by elapsed time.
Keyless reconciliation rechecks already recorded receipts: if a previously canonical block is orphaned,
the old receipt/check evidence remains, the same signed hash returns to pending, and any new canonical receipt
is appended. If another in-flight action already owns the signer, the re-lock fails closed; even after that
action finishes, new claims remain blocked until the orphaned hash is reconciled. Resolve it explicitly
without deleting history. Compare canonical receipt and original simulation hashes across post-state reads
before treating evidence as verified. The signer lock permits one in-flight run per Guardian across
accounts; an occupied signer leaves other triggers detected. On an existing database with conflicting
in-flight runs, the additive unique-index migration fails rather than deleting runs: reconcile or resolve
the conflicting signed attempts before migrating.

`pnpm smoke:adapters` runs every Task 5 adapter once, read-only, at a freshly pinned block and writes all
observations to `.tmp/adapter-smoke.json`; it exits 1 on any identity or route failure. The two accounts are
real holders discovered off-chain (the 2026-09-23 run used borrower `0x74d09665900A5f29BaC25BEfd30C73a5962d44e7`
and vault holder `0x6460D3441574e740E05d298ac2B24dE17B5bADc8`); their positions are verified onchain, never
assumed. `--doh` resolves HTTPS hosts over Cloudflare DNS-over-HTTPS for networks that hijack
`*.robinhood.com`; like the fork proxy it is dev-only transport.

Guardian defaults off. Starting it requires an explicit command and allowlisted account.

## 13. CI order

```text
verify pinned toolchains
→ frozen JS/Solidity install
→ generate ABI/schema/types and reject drift
→ PostgreSQL migrate
→ JS format/lint/type/unit/integration
→ Foundry format/build/unit/fuzz/invariant
→ static analysis
→ secret-gated pinned fork
→ web e2e
→ immutable builds
```

A missing external secret skips/fails visibly; it is never reported as passing live integration.

## 14. Mainnet canary

1. Reverify route, code, liquidity, vault withdrawal, and current rates.
2. Deploy and verify Crest Account source.
3. Configure small caps/floors and Guardian.
4. Fund canary amounts only.
5. Supply collateral.
6. Owner executes small `borrowAndDeploy`.
7. Confirm exact debt and vault shares.
8. Guardian freezes.
9. Guardian repays a bounded amount from strategy.
10. Verify accrued debt decreased and all floors/caps held.
11. Owner closes and withdraws.
12. Revoke Guardian or retain only for approved demo.
13. Record exact hashes, blocks, policy, rates, and environment.

Stop after any unexpected result. Never raise limits to make the demo work.

## 15. Security checklist

- compiler/dependency/source/code hashes pinned;
- secret and license scan;
- static analysis reviewed;
- unit/fuzz/invariant/fork suite fresh;
- Guardian selector/call-graph review;
- fixed vault receiver and own-debt beneficiary review;
- no proxy/arbitrary call/delegatecall/generic approval;
- debt, share, rate, cap, and floor boundaries tested;
- market/vault manifest independently reviewed;
- Guardian key isolated/minimally funded;
- database restart/reorg/idempotency recovery tested;
- alerts for stale monitor, vault constraint/loss, failed transaction, and failed postcondition.

## 16. Do not install/build in MVP

- Stylus/Rust;
- Safe/ERC-4337/ERC-7579;
- DEX/aggregator/flash-loan integration;
- Permit2/external token pull;
- dynamic vault router;
- Kafka/Redis/timeseries database;
- multiple LLM SDKs;
- Post-MVP A borrow-envelope methods;
- Post-MVP B multi-market/multi-vault or collateral-sale methods.

Each requires an approved scope and updated threat model.
