# Crest Installation and Development Enablement

This repository currently contains planning artifacts. Install runtime dependencies only when implementation starts from [BUILD-PLAN](../BUILD-PLAN.md).

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

Baseline verified on 2026-09-13; [Tech Stack](./TECH-STACK.md) is authoritative:

- Node.js `24.21.0` LTS;
- Corepack `0.36.0` with repository `packageManager: pnpm@12.4.1`;
- Foundry `1.8.1` and Solidity `0.8.37`;
- PostgreSQL `18.6`;
- Git;
- Docker only when used for local PostgreSQL;
- no Rust/Stylus dependency in MVP.

Use official Foundry installation instructions: <https://getfoundry.sh/introduction/installation/>.

On Windows, use one supported shell/environment and avoid multiple Foundry installations on PATH.

## 3. Project bootstrap

From the implementation root:

```bash
corepack enable
pnpm install --frozen-lockfile
docker compose up -d postgres
forge install
pnpm db:migrate
pnpm generate
pnpm verify
forge test
```

Lockfiles, remappings, and repository scripts are authoritative. Do not float Solidity dependencies after pinning.

## 4. Contract dependencies

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

## 5. JavaScript dependencies

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
```

These are a compatible bootstrap candidate, not permission to skip install/typecheck/build/fork verification. Refresh the complete set from official stable sources rather than floating one package independently.

Do not add a routing, agent, automation, or vault SDK when viem plus the verified ABI covers the required calls.

## 6. Environment contract

Commit `.env.example`, never credentials.

```dotenv
# Public
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=4663
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# Server only
DATABASE_URL=postgresql://crest:crest@localhost:5432/crest
ROBINHOOD_CHAIN_RPC_URL=
ROBINHOOD_API_BASE_URL=https://api.robinhood.com/rhj

# Guardian process only
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

## 7. Local PostgreSQL

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: crest
      POSTGRES_PASSWORD: crest
      POSTGRES_DB: crest
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crest"]
      interval: 2s
      timeout: 2s
      retries: 20
    volumes:
      - crest-postgres:/var/lib/postgresql/data
volumes:
  crest-postgres:
```

No Redis or message broker. One Guardian worker plus PostgreSQL leases/idempotency is MVP.

## 8. Deployment manifest

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

## 9. Fork setup

```bash
anvil \
  --fork-url "$ROBINHOOD_CHAIN_RPC_URL" \
  --fork-block-number <manifest-verified-block>
```

Run:

```bash
forge test --match-contract RobinhoodForkTest -vvv
pnpm test:integration:fork
pnpm smoke:fork
```

Fork prerequisites:

- exact manifest block available;
- market and vault exist at that block;
- test funding/impersonation is local and labeled;
- no production key loaded.

A fork proves compatibility at one state, not future rates or liquidity.

## 10. Fixtures

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

## 11. Canonical commands

```bash
pnpm dev
pnpm guardian:dev
pnpm db:migrate
pnpm generate
pnpm verify
forge fmt --check
forge build
forge test
forge test --match-contract CrestAccountInvariantTest
pnpm test:e2e
pnpm smoke:fork
```

Guardian defaults off. Starting it requires an explicit command and allowlisted account.

## 12. CI order

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

## 13. Mainnet canary

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

## 14. Security checklist

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

## 15. Do not install/build in MVP

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
