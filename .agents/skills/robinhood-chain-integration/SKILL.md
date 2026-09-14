---
name: robinhood-chain-integration
description: Use when configuring, verifying, reading, testing, or deploying Crest on Robinhood Chain; resolving Stock Token identity and lifecycle data; using RPC, Blockscout, Foundry, viem, wagmi, Morpho, or the deployment manifest; or reviewing chain-specific evidence and safety.
---

# Robinhood Chain Integration

Use official Robinhood documentation and direct chain evidence. Read `technical/INTEGRATIONS.md`, `technical/INSTALLATION.md`, and the active task in `BUILD-PLAN.md`; use `CONTEXT.md` only for initial orientation or a changed product decision.

## Network identity

| Network | Chain ID | Native gas | Public RPC | Explorer |
|---|---:|---|---|---|
| Mainnet | `4663` | ETH | `https://rpc.mainnet.chain.robinhood.com` | `https://robinhoodchain.blockscout.com` |
| Testnet | `46630` | ETH | `https://rpc.testnet.chain.robinhood.com` | `https://explorer.testnet.chain.robinhood.com` |

Public RPCs are rate-limited. They are suitable for discovery and focused verification, not an availability promise. Verify `eth_chainId` on every environment and before every write. Require explicit user authorization immediately before a mainnet transaction.

## Evidence workflow

1. Identify network, requested block or finality point, account, and read/write intent.
2. Resolve token and protocol addresses from current official sources; ticker, name, dashboard row, or explorer label is discovery only.
3. Read bytecode and record code hash, block number/hash, retrieval time, source URL, and deployment version.
4. For Morpho, verify chain plus all five market parameters and recompute the market ID. Use the official `borrow-integration` skill.
5. Verify the exact vault generation and interface before applying ERC-4626 behavior. Use the official `earn-integration` skill; Vault V2 max functions returning zero must not be interpreted as unavailable liquidity.
6. Keep one coherent block horizon for chain, Morpho, oracle, account, and vault state. Label indexed/API observations separately.
7. Before a write, refresh state, satisfy current SDK requirements, simulate the exact authorized transaction, show its target/selector/value/receiver/effect, submit only with the correct wallet authority, then reconcile receipt and fresh post-state.
8. Store only reviewed evidence in `config/deployment-manifest.json`; make its verifier fail on chain, code, market, token, vault, or block mismatch.

## Stock Token identity and lifecycle

Official API base:

```text
https://api.robinhood.com/rhj/
```

Use:

- `/assets` for stable asset identity, deployments, multiplier fields, effective time, and provider status;
- `/prices/{symbol}` for advisory underlying-market bid/ask, halt, and generation time;
- `/corporate-actions` for advisory lifecycle records.

Rules:

- match `(chainId, checksummed contractAddress)` and verify bytecode;
- preserve raw token balance, UI-equivalent exposure, and oracle value as distinct typed values;
- do not apply a UI multiplier twice when the selected onchain feed already incorporates it;
- treat halt, multiplier, corporate-action, or missing REST data only as tightening inputs;
- never use REST price as Morpho collateral price or smart-contract authority;
- `oraclePaused() == false` does not replace feed freshness, round, scale, or sequencer checks.

## Tooling

Use the smallest tool that proves the fact:

```bash
cast chain-id --rpc-url "$ROBINHOOD_CHAIN_RPC_URL"
cast block-number --rpc-url "$ROBINHOOD_CHAIN_RPC_URL"
cast code <address> --rpc-url "$ROBINHOOD_CHAIN_RPC_URL"
cast call <address> "<signature>" <args> --rpc-url "$ROBINHOOD_CHAIN_RPC_URL"
forge test --match-contract RobinhoodForkTest -vvv
```

- `forge`: unit, fuzz, invariant, fork, and deployment scripts;
- `cast`: direct identity, code, call, receipt, and log evidence;
- `anvil`: fork the manifest-pinned Robinhood block;
- `viem`: typed application reads, simulation, receipts, and custom chain definition;
- `wagmi`: owner wallet connection and signatures;
- Blockscout: discovery and source/transaction cross-check, not a substitute for RPC state;
- official Morpho SDK/API: protocol entity, transaction, indexed discovery, and history surfaces.

Never place an owner or Guardian private key in commands, source, logs, screenshots, fixtures, or client environment. Test keys must be disposable local/fork keys.

## Manifest minimum

Record:

- chain ID, RPC class, block number/hash, and retrieval time;
- token addresses, decimals, bytecode hashes, and official source;
- Morpho deployment, exact MarketParams, derived ID, oracle/IRM/LLTV, and liquidity observation;
- vault address, generation, underlying, code hash, roles/upgrades, fees, caps, allocation exposure, withdrawal paths, and simulation result;
- rate value, scale, APR/APY convention, components, source, and freshness;
- classification: `qualified`, `candidate`, `support_only`, `watchlist`, `rejected`, `reserve_only`, or `unsupported`, with reason.

## Stop conditions

Stop rather than invent or substitute when:

- chain ID, address, code hash, market ID, oracle scale, or vault asset mismatches;
- a required official source or current block cannot be obtained;
- market liquidity, vault exit behavior, or exact simulation fails;
- an action would expand Guardian authority, choose a receiver/venue, create debt, sell collateral, or route dynamically;
- evidence comes only from a ticker, promotional APY, explorer label, third-party indexer, or stale API response.

A failed market gate stops downstream implementation. A passed market plus failed vault gate produces the documented `reserve_only` fallback without a yield claim.

## Primary sources

- https://docs.robinhood.com/chain/
- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/contracts/
- https://docs.robinhood.com/chain/stock-tokens/
- https://docs.robinhood.com/chain/stock-token-apis/
- https://docs.robinhood.com/chain/oracles-and-price-feeds/
- https://docs.robinhood.com/chain/deploy-smart-contracts/
