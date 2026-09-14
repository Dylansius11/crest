# Crest Integrations

## 1. Integration matrix

| Integration | MVP | Authority | Use |
|---|---:|---|---|
| Robinhood Chain RPC | Required | Canonical onchain state at identified blocks | Contracts, balances, events, simulation, receipts |
| Robinhood Stock Token APIs | Required | Advisory lifecycle context | Deployments, multiplier, halt, corporate actions |
| Stock Token contracts | Required for selected collateral | Canonical token state | Balance, multiplier, advisory pause |
| Exact market oracle | Required | Morpho valuation authority | Collateral value and protocol health |
| Sequencer guard | Required when oracle guidance requires | Availability guard | Reject unsafe price use |
| Morpho Blue | Required | Lending authority | Market, position, supply, borrow, repay, withdraw |
| Fixed loan-token vault | Required for yield-loop MVP | Strategy state | Deposit, shares/assets, withdrawable liquidity, redemption |
| Crest Account | Required; built by Crest | Owner policy authority | Caps, fixed route, freeze, bounded repayment |
| wagmi + viem | Required | Client integration | Reads, simulation, wallet signatures |
| PostgreSQL | Required | Offchain audit/coordination | Observations, policy, triggers, receipts, postconditions |
| LLM provider | Optional | Untrusted draft | Natural-language policy draft only |
| Stylus | Not MVP | None | Add only after measured need |

## 2. Robinhood Chain

Current official connection documentation identifies Robinhood Chain as EVM/Arbitrum-based, mainnet chain ID `4663`, with ETH as gas.

Rules:

- verify `eth_chainId` and bytecode;
- source addresses from current official material plus onchain verification;
- never accept a display name or ticker as identity;
- record address, code hash, source URL, verification block/hash, and retrieval time;
- reverify immediately before fork/mainnet demo.

The event-period `deployment-manifest.json` is the reviewed route registry for contracts, apps, fork tests, and the UI.

## 3. Robinhood Stock Token APIs

Documented base path:

```text
https://api.robinhood.com/rhj/
```

### `/assets`

Use:

- stable asset ID/UID;
- canonical deployment by chain/address;
- current and pending UI multiplier;
- effective time and provider asset status.

Match `(chainId, checksummed contractAddress)` and verify bytecode. Ticker is display metadata.

### `/prices/{symbol}`

Use:

- underlying-equity bid/ask context;
- `isTradingHalt`;
- provider generation time.

Do not use this endpoint as Morpho collateral price. A halt does not prove ERC-20 transfer or liquidation stopped.

### `/corporate-actions`

Use:

- stable action ID;
- action type/status;
- documented process/effective fields;
- lifecycle explanation and conservative freeze input.

Do not infer payable/effective semantics that the provider field does not state.

### Trust rule

```text
normal lifecycle response   -> no new permission
degraded lifecycle response -> capacity may become zero; freeze/alert
missing lifecycle response  -> unknown/degraded
```

Unsigned REST data never reaches the smart contract as a price or authority claim.

## 4. Stock Token contract and oracle semantics

Current official documentation describes UI multiplier and pause-related reads. The selected token/feed behavior must be verified against its deployed code and official source.

### Double-adjustment trap

The Stock Token onchain price feed may already include the UI multiplier. Therefore:

- use exact market-oracle semantics for Morpho value;
- never multiply a multiplier-adjusted feed again;
- keep raw token balance, UI-equivalent display, and oracle valuation as separate typed values;
- store token, feed, multiplier, and WAD scales explicitly.

`oraclePaused()` is advisory. `false` does not replace feed freshness/round/sequencer checks; `true` means degraded, not price zero.

## 5. Morpho Blue

### Exact market identity

```text
loanToken
collateralToken
oracle
IRM
LLTV
```

The derived market ID must match the official SDK and deployed core.

### Required reads

- exact parameters and market ID;
- market totals, rates, fee, and available loan liquidity;
- Crest Account collateral and borrow shares;
- accrued current debt rounded up;
- oracle value/scale/freshness;
- deployment code and version.

### Required writes

- supply collateral;
- owner-only borrow exact assets to Crest Account;
- partial repay exact assets;
- owner collateral withdrawal;
- accrue interest before debt-sensitive checks.

### Critical facts

- Morpho collateral earns no supply yield.
- Loan-token suppliers earn through supply shares.
- A different market's collateral or liquidity cannot rescue this position.
- Full close should use fresh borrow shares to avoid debt dust.

## 6. Fixed loan-token yield vault

### Required semantics

Prefer ERC-4626:

```text
asset
balanceOf
convertToAssets
previewDeposit
previewWithdraw
maxDeposit
maxWithdraw
deposit
withdraw
```

An adapter is allowed only when the production vault is not compatible and the adapter remains fixed, narrow, audited, and free of arbitrary routing.

### Qualification gate

1. verify chain, address, bytecode, source, interface, and `asset()`;
2. require vault asset equals Morpho loan token;
3. inspect curator/manager/guardian roles and upgradeability;
4. document downstream allocations and protocol concentration;
5. document fees, rewards, caps, pause, queues, and loss behavior;
6. test preview versus actual deposit/withdraw rounding;
7. measure `maxDeposit`, `maxWithdraw`, and `maxRedeem`;
8. simulate owner borrow-and-deploy;
9. simulate Guardian strategy-repay;
10. prove accrued debt decreased and no value reached Guardian.

### Robinhood Earn candidate

Robinhood publicly describes an Earn route using USDG and Morpho-curated lending. Treat its current vault as a candidate discovery source. Do not hard-code a vault, APY, or curator statement until the current deployment and state pass the gate.

### DeFi candidate landscape

Current official ecosystem evidence supports **Morpho as Crest's only lending engine for MVP**. Robinhood Earn's Steakhouse-curated USDG vault is a Morpho Vault allocation layer, not an independent lending protocol. Other protocols may support funding, pricing, or owner-directed exits, but they do not justify widening Guardian authority.

| Candidate | Current Crest status | Potential role | Decision |
|---|---|---|---|
| Exact Morpho Blue Stock Token/USDG market | `candidate` | Collateralized borrowing | Only lending route documented in the current Robinhood Chain ecosystem; becomes `qualified` only after the complete market gate and pinned-fork proof |
| Steakhouse-curated Morpho USDG Vault exposed through Robinhood Earn | `candidate` | Fixed loan-token yield destination | Best current discovery target; verify the exact vault, underlying, allocations, roles, upgrades, fees, caps, and withdrawals before use |
| Uniswap | `support_only` | Owner-directed acquisition or exit liquidity | Not an MVP yield source and never a Guardian-selected route; reconsider only with a fixed audited adapter and separate oracle/slippage/MEV review |
| Chainlink | `support_only` | Oracle infrastructure | Use only when the exact qualified Morpho market depends on the verified feed and required sequencer/freshness guards |
| LayerZero or canonical bridge | `support_only` | Owner funding/bridging | Outside debt protection and yield accounting; never part of an automated Guardian value path |
| Aave, Euler, or Dolomite | `watchlist` | Alternative lending | No current official Robinhood Chain deployment evidence is recorded here; do not claim support without deployed code, liquidity, oracle, and fork proof |
| Pendle or LP-based yield | `watchlist` | Alternative yield | Adds maturity, swap, impermanent-loss, routing, or exit-liquidity risk; not compatible with the narrow MVP until separately designed and qualified |
| Lighter or Arcus perpetuals | `rejected` | Leveraged trading/hedging | Increases trading, funding, and liquidation risk instead of preserving the non-extractive debt-reduction boundary |

Status meanings:

- `qualified`: exact deployment, code, route state, liquidity, and pinned-fork behavior pass the gate at a recorded block/time;
- `candidate`: official evidence exists, but one or more runtime qualification checks remain;
- `support_only`: useful infrastructure that does not become the lending/yield engine or expand Guardian authority;
- `watchlist`: potentially relevant later, with no verified executable Robinhood Chain route in the manifest;
- `rejected`: conflicts with Crest's MVP authority or risk model.

Every candidate assessment records deployment source, chain/address/code hash, underlying asset, liquidity and withdrawal behavior, oracle dependencies, fees, roles/upgrades, Guardian authority impact, and pinned-fork result. A dashboard listing, brand partnership, ticker match, TVL, or advertised APY cannot promote a candidate.

### Withdrawal truth

```text
quoted strategy assets = convertToAssets(accountShares)
currently withdrawable = min(quoted strategy assets, maxWithdraw(account))
actionable repayment    = min(currently withdrawable, successful simulation, policy bounds)
```

Vault TVL, displayed APY, or `previewRedeem` alone is not actionable liquidity.

## 7. APY and net-carry sources

Every observation records:

- source/provider;
- generated/fetched timestamp;
- period and compounding convention;
- gross/net-of-vault-fee meaning;
- base rate versus incentives;
- confidence/freshness status;
- raw value and explicit scale.

Keep separate:

```text
borrow APY
vault base APY
incentive APR
vault/protocol fees
estimated execution cost
estimated annual net carry
realized strategy earnings
realized debt repayment
```

A displayed negative effective borrow APY is not a primitive. It is a derived ratio and can become extreme when current debt is tiny. The UI must lead with absolute stablecoin amounts.

Rate degradation blocks new owner-borrow recommendation. It does not block an otherwise freshly simulated debt-reducing repayment.

## 8. Market-and-vault route gate

A route is executable only when both independent gates pass at the same observation horizon:

1. exact Morpho deployment/market identity;
2. canonical collateral/loan token identity;
3. usable Morpho loan liquidity after buffer;
4. exact vault identity and same underlying loan token;
5. current vault deposit capacity;
6. current vault withdrawal behavior;
7. compatible oracle/sequencer/lifecycle state;
8. pinned-fork end-to-end success;
9. manifest evidence;
10. request size within both market and strategy bounds.

Classification:

- `eligible_liquid`;
- `eligible_constrained`;
- `unsupported`;
- `blocked_by_policy`;
- `degraded`.

The classification belongs to the route at a block/time, not permanently to a ticker.

## 9. Crest Account integration

The UI policy preview maps one-to-one to configuration calldata. The database marks policy active only after a canonical event.

Guardian selectors:

```text
freezeBorrowing()
repayFromReserve(uint256)
repayFromStrategy(uint256)
```

Application allowlists are defense-in-depth. Contract absence of borrow/receiver/arbitrary-call authority is the primary boundary.

Every repayment independently reconciles:

- accrued debt before and after;
- idle reserve before and after;
- vault shares/assets before and after;
- configured floors/caps;
- canonical receipt and events.

## 10. Wallet integration

Use wagmi + viem.

Owner signs:

- account deployment/configuration;
- token approvals/funding;
- collateral supply;
- `borrowAndDeploy`;
- owner strategy deposit/withdraw;
- owner repay/withdraw;
- Guardian change/revocation;
- policy changes and unfreeze.

Read-only inventory, route discovery, and monitoring work without connection.

No owner private key, seed phrase, or raw signature enters Crest storage. Transaction previews show chain, target, selector, route, token, amount, min shares/max shares, simulation block, and policy effect.

## 11. Guardian transaction integration

### Pre-submit

- claim idempotency key;
- refresh policy nonce, freeze, accrued debt, reserve, vault shares/assets, and `maxWithdraw`;
- confirm trigger remains valid;
- simulate exact permitted selector from Guardian address;
- record unsigned calldata hash and expected postconditions.

### Submit/reconcile

- sign only in isolated Guardian process;
- persist attempt/hash before retry decision;
- wait for canonical receipt with bounded timeout;
- independently read Crest Account, Morpho, and vault post-state;
- mark verified only when expected freeze/debt/floor/cap conditions hold;
- otherwise keep frozen and alert.

No generic RPC transaction endpoint is exposed.

## 12. Optional natural-language policy

The model returns an untrusted draft matching strict schema. Validation rejects:

- market/vault selected by ticker/name alone;
- unknown asset intent;
- invalid LTV ordering;
- invented APY, oracle, LLTV, or liquidity;
- unsupported Guardian borrowing;
- arbitrary receiver/venue/swap;
- cap below current position;
- vault asset different from loan token;
- missing base-unit confirmation.

Manual typed policy remains complete without an LLM.

## 13. Failure matrix

| Failure | Effect | Response |
|---|---|---|
| No usable Stock Token market | Borrow route cannot execute | Show unsupported; do not create empty market |
| No same-loan-token vault | Yield loop cannot execute | Use reserve-only protection fallback |
| REST lifecycle stale | Lifecycle uncertain | Capacity zero/freeze by policy |
| Rate source stale | Carry unknown | No additional-borrow recommendation |
| Oracle paused/stale | Health unreliable | Freeze; no REST price substitute |
| Multiplier applied twice | Material valuation error | One typed formula owner and test vectors |
| Debt accrues between reads | Cap/repay drift | Accrue/read fresh in contract/action |
| Vault APY falls | Spread inversion | Freeze new debt; exit toward reserve/debt |
| `maxWithdraw` falls | Repayment liquidity lower | Partial bounded repay; alert |
| Vault share loss | Strategy assets impaired | Recalculate; freeze; no profit claim |
| Guardian compromised | Unauthorized attempts | Contract permits freeze/own-debt repayment only |
| Duplicate delivery | Duplicate gas/action | Idempotency + fresh state + reconciliation |
| Reorg | Evidence/action orphaned | Block-hash tracking and state rollback |
| Collateral sale tempting | Authority escalation | Not in MVP; owner manual action |

## 14. Post-MVP integration boundaries

### Post-MVP A

EIP-712 borrow envelope plus a new audited contract. Borrowed funds remain forced into the fixed vault. No generic signature/executor.

### Post-MVP B

Each additional market/vault passes its own gate. A coordinator aggregates views; it does not merge collateral. Any swap adapter has one fixed venue/interface and separate oracle/slippage/MEV review.

## 15. Go/no-go checklist

- [ ] Current chain/deployment manifest verified.
- [ ] One Morpho market passes all checks.
- [ ] One same-loan-token vault passes all checks.
- [ ] Pinned fork executes supply, owner borrow-and-deploy, freeze, strategy repay, and owner exit.
- [ ] Morpho collateral APY displays as zero.
- [ ] Rate/carry math matches explicit source conventions.
- [ ] Degraded source creates no positive borrow capacity.
- [ ] Guardian call graph is non-extractive and debt-non-increasing.
- [ ] Vault receiver and repayment beneficiary are fixed to Crest Account.
- [ ] Every claimed repayment proves accrued debt decreased.

If the vault fails, ship the reserve-only fallback without claiming yield.

## 16. Sources

- [Robinhood Chain](https://docs.robinhood.com/chain/)
- [Robinhood Stock Tokens](https://docs.robinhood.com/chain/stock-tokens/)
- [Robinhood Stock Token APIs](https://docs.robinhood.com/chain/stock-token-apis/)
- [Robinhood oracles and price feeds](https://docs.robinhood.com/chain/oracles-and-price-feeds/)
- [Robinhood Earn](https://robinhood.com/us/en/crypto/earn/)
- [Robinhood Chain ecosystem](https://docs.robinhood.com/chain/ecosystem/)
- [Morpho: Robinhood Earn and Steakhouse-curated vault](https://morpho.org/blog/robinhood-chooses-morpho-to-power-new-earn-product)
- [Morpho data for Robinhood Chain](https://data.morpho.org/chain/robinhood-chain)
- [Morpho core contracts](https://docs.morpho.org/developers/contracts/morpho/)
- [Morpho market mechanics](https://docs.morpho.org/developers/borrow/concepts/market-mechanics/)
- [Morpho LTV and health](https://docs.morpho.org/developers/borrow/concepts/ltv/)
- [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)
- [viem](https://viem.sh/)
- [wagmi](https://wagmi.sh/)
