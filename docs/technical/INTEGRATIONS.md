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

Robinhood Chain mainnet is EVM/Arbitrum-based, chain ID `4663`; the testnet is chain ID `46630` with ETH gas. Each chain has its own manifest and a fixed trust tier: `config/deployment-manifest.json` is the **reviewed** 4663 route, and `config/deployment-manifest.46630.json` is the **SANDBOX** 46630 route. The validator rejects a 46630 manifest that claims `reviewed`, a 4663 manifest that claims `sandbox`, and a sandbox without disclosures.

Rules:

- verify `eth_chainId` and bytecode;
- source addresses from current official material plus onchain verification;
- never accept a display name or ticker as identity;
- record address, code hash, source URL, verification block/hash, and retrieval time;
- reverify immediately before fork/mainnet demo.

The manifests are the route registry for contracts, apps, fork tests, and the UI; `DEPLOYMENT_MANIFEST_PATH` selects the active one. Verify the sandbox with `node scripts/verify-deployment-manifest.ts --manifest config/deployment-manifest.46630.json --rpc <testnet proxy>`; the verifier reports a reverting sandbox oracle as drift and checks the vault's liquidity adapter, and checks the AdaptiveCurveIrm Morpho binding only on the reviewed route.

### Testnet candidate status (2026-10-01)

Approach 1 is **experimental and read-only in Crest**. A TLS-authenticated connection to `https://rpc.testnet.chain.robinhood.com/rpc` through the existing SNI-preserving proxy returned chain ID `46630`. At finalized block `127234001` (`0xdb19c57b9ed59613ee39cfe11623c5305da8894485df91d959dfd72079d3d544`, 2026-10-01 17:19:22 UTC), the Morpho core [`0x2275d8C96E52C3368E062aA04F41578E9bFb99d3`](https://explorer.testnet.chain.robinhood.com/address/0x2275d8C96E52C3368E062aA04F41578E9bFb99d3) exposed TSLA-labeled collateral `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E` against [Paxos testnet USDG](https://docs.paxos.com/guides/stablecoin/usdg/testnet) `0x7E955252E15c84f5768B83c41a71F9eba181802F`. Market `0xa5b036cccef6ef2079619c6c438aec1a223f451ef17b2304de2dd262c637d80d` uses oracle `0xb92da213f9428e19c9e212dbf50a469b959e0a8c`, IRM `0x438c11352e0e9226d71584b70d86912c389cc42c`, and 86% LLTV. It held 10 USDG supply against 9 USDG borrow: **1 USDG shared free liquidity at that block**, not a reservation or a current quote.

Among the explorer-source-verified Vault V2 contracts, [`0xA630E3995B74C9Dc50Bf05eF6bbBD1D7C67b9D41`](https://explorer.testnet.chain.robinhood.com/address/0xA630E3995B74C9Dc50Bf05eF6bbBD1D7C67b9D41) has the **exact Paxos USDG** underlying. Its liquidity adapter `0x13D1a376d3e2d5d77e5fb52dbe1576A36bA36172` uses the **same** Morpho core; its default downstream market is `0x54f0f9c9c7428ac75b68019b2d930813e8e9df45675ed8078b5ee99535366200`, backed by a `FakeWBTC`-labeled mock collateral. The vault is not evidence of production yield or a real BTC market. The other two explorer-source-verified Vault V2 contracts (`0x581a1A5C8102f110a2d404660239100E1aA5f805`, `0xA63A21c23Ce74612B823DF21D893B5527c215537`) returned different assets. Factory events reveal two additional exact-asset V2 vaults without verified source at their own addresses; see the 2026-10-02 audit below.

`contracts/test/RobinhoodTestnetCandidate.t.sol` replayed a finalized fork: fork-funded 1 TSLA-labeled token, 0.1 USDG owner borrow/deposit, Guardian freeze and 0.05 USDG strategy repayment, then owner repayment and collateral withdrawal. The fork had **cheatcode-funded collateral and debt close**, not a wallet transaction, live account, APY, or a canonical receipt. Blockscout verifies the collateral's BeaconProxy/`Stock` implementation, but the [official `/rhj/assets` registry](https://api.robinhood.com/rhj/assets) returned **194 assets and zero `chainId: 46630` deployments** at 2026-10-01 17:47 UTC; TSLA listed only `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` on mainnet 4663. The market oracle has unverified source; `owner()` exposes an externally controlled address, and a selector matches `setPrice(uint256)`, but its implementation and price/feed freshness are **not proven**. Crest's existing risk engine requires independent collateral/loan feeds, and this candidate supplies no verified feeds. **No `full_route` gate, testnet manifest migration, or owner signature is authorized**. The checked-in 4663 manifest remains archival, and testnet debt creation must stay unavailable until these dependencies and a current exact simulation are proven. Testnet USDG has no monetary value.

#### Issuer, oracle, market, and vault recheck (2026-10-02)

The [Robinhood Stock Token API specification](https://docs.robinhood.com/chain/stock-token-apis/) says `/rhj/assets[].id` is the onchain `uid()` and stays the same across chains for one asset. A TLS-authenticated official RPC read at **head** block `127410311` (`0xa1852d2609bd295c7bf3eee3b867b731c9f8f65bc87776e2bf33048016e81b39`, 03:54:34 UTC) found that the faucet TSLA token's `uid()` is `0x00000000000000000000000000000000aa1fee9afa45465cbc65157b4edf63f5`, while the [issuer registry](https://api.robinhood.com/rhj/assets) lists TSLA as `0x00000000000000000000000000000000cfece3244ea34bb29414dd9488b32d9f`. AMZN, NFLX, PLTR, and AMD faucet tokens **also each have a different UID** from their respective issuer-registry asset IDs at this block. The same API read (03:54:37 UTC) returned 194 assets, zero deployments for chain 46630, and only mainnet 4663 for registered TSLA. The [official testnet faucet](https://faucet.testnet.chain.robinhood.com/) distributes test Stock Tokens, but a ticker, proxy implementation named `Stock`, and faucet delivery do **not** establish that these five contracts represent the same registered securities across chains. This is a measured identity mismatch, not just missing testnet metadata; do not qualify the current TSLA collateral as a registered Robinhood Stock Token.

The **110 USDG figure is lending-market free liquidity, not vault liquidity**. At head block `127410031` (`0xe5ce91372da9646f72896a9f568e7375fea83a4eb9a3049ea982909faf9c8ab8`, 03:53:41 UTC), [Morpho core `0x99607363652591ffF66BA23EF8D91563CA48038b`](https://explorer.testnet.chain.robinhood.com/address/0x99607363652591ffF66BA23EF8D91563CA48038b) market `0x165f9db8f5e1d9982a35dfaadb3f944cf747970c8f819f16f10105f5c7eb6e04` held 140.000010 USDG supplied, 29.760859 borrowed, **110.239151 USDG free**. Its [verified `VigilOracle`](https://explorer.testnet.chain.robinhood.com/address/0x79da01db22808e3a7397b788f171a7647b1bef8f) reads [verified `MockFeed` `0x87ae97dd57686e9fbc85ce9d33cc39b6594c49c3`](https://explorer.testnet.chain.robinhood.com/address/0x87ae97dd57686e9fbc85ce9d33cc39b6594c49c3): source exposes unrestricted external `set(int256)` and `setAt(int256,uint256)`. Its [IRM](https://explorer.testnet.chain.robinhood.com/address/0xc15db6c9c5b7bad92c088e0918d5c720a5c44630) is verified `MockIRM` with a fixed rate. A second TSLA/Paxos USDG market on this core has **zero** supply; its `ControlOracle` reads the **same** mock feed. The AMD, AMZN, NFLX, and PLTR/Paxos USDG markets discovered on this core also bind to verified `MockFeed` contracts with the same unrestricted setter design (10, 10, 10, and 11.5 USDG free respectively). Core `0x2275…99d3` still has **1 USDG shared free** in its TSLA market, with unverified oracle source. An index of Morpho-labelled cores yielded nine exact-Paxos-USDG `CreateMarket` events; that index is not an exhaustive proof about every deployment on chain 46630. More free lending liquidity cannot repair a publicly settable collateral price, synthetic interest rate, or issuer UID mismatch.

The [verified Vault V2 factory](https://explorer.testnet.chain.robinhood.com/address/0x7884dDF7F683006DF79040EE311b87B3148E1418) emitted 20 `CreateVaultV2` events, **three for exact Paxos test USDG**. Its `isVaultV2` returned true for all three; each has the **same runtime bytecode** as explorer-source-verified `0xA630…9D41`. At the *same head block* `127410031`, loan-token balances and the read-only normal-exit bound from `VaultV2Liquidity` were:

| Vault V2 | Quoted `totalAssets` | Idle USDG | Normal-exit upper bound | Adapter and risk |
| --- | ---: | ---: | ---: | --- |
| [`0xA630…9D41`](https://explorer.testnet.chain.robinhood.com/address/0xA630E3995B74C9Dc50Bf05eF6bbBD1D7C67b9D41) | 1535.306283 | 1 | 9.543482 | Same `0x2275…99d3` core; adapter market backed by `FakeWBTC`. |
| [`0x70f5…21bc`](https://explorer.testnet.chain.robinhood.com/address/0x70f514670d554f3388e15ebce2c7aa37307a21bc) (`testLPVault`) | 80 | 63 | **63** | `liquidityAdapter()` is zero, so only idle assets bound normal exit; its other adapter `0xb5c5…b71d` still allocates to the `FakeWBTC` market on core `0x2275…99d3`. Source at the vault/adapter addresses is not explorer-verified. |
| [`0x5ee8…46ce`](https://explorer.testnet.chain.robinhood.com/address/0x5ee84f9f91b5fffd19d3a6cddc9ce198423746ce) | 18.965093 | 0 | 8.543482 | Adapter also uses `0x2275…99d3` and the `FakeWBTC` market; source at this vault/adapter is not explorer-verified. |

These capacities are upper bounds across all holders, **not** a user's `maxWithdraw`, guaranteed liquidity, or yield. At head block `127410529` (`0x35b46a03c479b46929eddbb381e8f051d2e44f0cd62ea0757adbd791f5f8a4ce`), an `eth_call` from `testLPVault`'s existing share owner simulated a normal **0.1 USDG** withdrawal successfully; it produced no canonical receipt and did not prove a new Crest deposit or yield. `VaultV2Liquidity.validate` accepts a zero liquidity adapter without requiring the loan-market core to match the vault's *other* allocations, and `available` then caps repayment at the 63 USDG idle balance, so the 110-USDG loan market can configure this idle-only route without a Solidity change (fork-proven below). Its public mock price and token identity mismatch keep it a SANDBOX route, never a qualified yield route. Do not substitute quoted assets, lending capacity, or a mock-backed allocation for withdrawable earnings.

#### Sandbox route decision and fork proof (2026-10-02)

No primary source publishes a 46630 route that can pass the reviewed gate: the [issuer registry](https://api.robinhood.com/rhj/assets) lists zero 46630 deployments, Chainlink's [network directory](https://github.com/smartcontractkit/documentation/blob/main/src/features/data/chains.ts) lists only *Robinhood Chain Mainnet* (`feeds-robinhood-testnet.json` returns 404), Robinhood's [oracle page](https://docs.robinhood.com/chain/oracles-and-price-feeds/) defers feed addresses to that directory, and [Morpho's address page](https://docs.morpho.org/get-started/resources/addresses/) lists only the Robinhood mainnet deployment. On 2026-10-02 the owner chose a **labeled 46630 SANDBOX first** and kept the reviewed 4663 route registered but signing-disabled.

The sandbox route is the TSLA/USDG market `0x165f9db8f5e1d9982a35dfaadb3f944cf747970c8f819f16f10105f5c7eb6e04` on Morpho core [`0x99607363652591ffF66BA23EF8D91563CA48038b`](https://explorer.testnet.chain.robinhood.com/address/0x99607363652591ffF66BA23EF8D91563CA48038b), with faucet TSLA, Paxos test USDG, oracle `0x79DA01DB22808E3A7397B788F171a7647b1bEf8f` (`VigilOracle` reading a publicly settable `MockFeed`), `MockIRM` `0xc15Db6c9c5B7bAd92C088E0918D5C720A5c44630`, and 86% LLTV. The vault is the idle-only Vault V2 [`0x70F514670d554f3388e15eBce2c7Aa37307A21Bc`](https://explorer.testnet.chain.robinhood.com/address/0x70F514670d554f3388e15eBce2c7Aa37307A21Bc) with no liquidity adapter. At finalized block `127410497` (`0xeac1aaebf99685eebc8bef59fcebc37c1e258903fcbfe25cad0bd8f775e5145a`, 03:55:06 UTC), the market had 110.239151 USDG free and the vault held 63 USDG idle; the oracle quoted 346.0565 USDG per TSLA at head block `127417261`.

`contracts/test/RobinhoodTestnetSandbox.t.sol` proves, on a fork: configure binds the zero liquidity adapter; supply 1 TSLA; owner borrows and deploys 10 USDG; Guardian cannot borrow; Guardian freezes and repays at most 5 USDG from the vault with no proceeds left in the account; owner borrowing reverts while frozen; owner withdraws the strategy, repays, and recovers the collateral. Trust stays **SANDBOX**: anyone can move the price, liquidate the position, or borrow the market dry, the token is not issuer-registered, and the idle vault earns no yield.

**Live canary (2026-10-02).** The same route ran end to end on canonical 46630 with owner MetaMask signatures and the Custos Guardian key: Crest Account [`0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75`](https://explorer.testnet.chain.robinhood.com/address/0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75) (Sourcify `match`; Blockscout lacks solc 0.8.37), 1 TSLA supply, 10 USDG borrow into the vault, Guardian freeze, Guardian `repayFromStrategy` of 6.421094 USDG under PROTECT, owner close, and owner unfreeze. Every hash, block, policy, and postcondition is in [`docs/evidence/canary-live-46630.json`](../evidence/canary-live-46630.json). Trust stays **SANDBOX**; rates, the USDG feed, and lifecycle inputs read as `unreadable` throughout.

`config/deployment-manifest.46630.json` records this route at finalized evidence block `127414784` (`0x6ce23e0d7d93e26936e953d198dad051d01d6eabe01c9e61006147493b24a5e8`, 04:08:03 UTC), where the fork proof is now pinned: 110.239151 USDG free, 63 USDG idle, 22.434235 USDG allocated to adapter `0xb5c5…b71d` in the `FakeWBTC` market on core `0x2275…99d3`, oracle price 346.0565 USDG per TSLA, MockIRM 5% simple APR, vault timelock 0, no gates. The recorded lifecycle borrowed 10 USDG, Guardian repaid 5, and the owner repaid 5.000001 and recovered 1 TSLA. The online verifier passed against the TLS-authenticated testnet RPC.

**Oracle liveness.** `VigilOracle.price()` reverts `VigilStale` once its `VigilSessionOracle` judges the `MockFeed` unusable: with TSLA's `marketStaleSeconds` 21600 × `hardStaleMult` 3, the feed must have updated within 18 h of the market's last open while the calendar is open, and within 18 h before `closeAt` while closed. The feed last updated 2026-10-01 18:44:11 UTC, so without a new `set()` the price is expected to become unusable after the 2026-10-02 close [INFERENCE from the source and config, not yet observed]. A reverting price blocks owner borrowing and collateral withdrawal with debt; repayment does not read the oracle. Simulate before every owner signature.

#### Wallet funding observations (2026-10-02)

- [Robinhood faucet transaction](https://explorer.testnet.chain.robinhood.com/tx/0x1f2545c70d7af9e4d7b82aa116efce1dbfb11c8515f14490bcf999bd79819fb5) succeeded in block `127389265` (02:49:28 UTC): verified `Faucet` `0x8762F93772c663c6a88Ba50900bd5381df2717Be` minted 5 each of TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, AMZN `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`, PLTR `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0`, NFLX `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93`, and AMD `0x71178BAc73cBeb415514eB542a8995b82669778d` (18 decimals) to `0x1c03c106aEEEe3c8f3a2Bf57B1F3f085F509a63F`. Its internal transfer delivered 0.01 testnet ETH to the same wallet.
- [Paxos USDG transaction](https://explorer.testnet.chain.robinhood.com/tx/0x5fb6393b23710855fa786c3197cdde2d6681f0b4647575872184ffb63a3c8a56) succeeded in block `127385629` (02:38:25 UTC): `transfer` of `100000000` base units = **100 test USDG** from `0xcc9644EC26A647de0B9b86f1560d5180232f70a3` to a **different** wallet, `0x712683F374Cd524F6336E87D577Fc39d1102930A`, on the exact Paxos USDG token `0x7E955252E15c84f5768B83c41a71F9eba181802F` (6 decimals). This is a transfer receipt, not USDG minted in this transaction.
- Direct official RPC read at block `127391043` (`0x5801d9c4a999b3884374ab64d145189ace6baccec5e9e79a295324b130e6d334`, 02:55:02 UTC): the first wallet held 5 of each listed stock token and 0.01 ETH; the second held 100 USDG and 0.01 ETH. A separate read at block `127391681` (`0x6813be40623a68873799b5135778e7fd44ff1115d08b7a8e1ea8bbaed5c0cb92`) found **zero USDG** in the first wallet. At block `127391735` (`0x35ac8c4675618d23c551033453ef87e5a8e035dc51b1aafe749b40f41cc16d47`), the second wallet also held 5 of each listed stock token. The provided Robinhood faucet transaction does **not** establish how the second wallet acquired its stock tokens. Balances are observations at different blocks, never combined into a single wallet or attributed to the wrong receipt.
- At block `127391601` (`0xefb49234680ce2514db29c6b2e12dcc3c2cf5ec36b72ad979ce536fdfdfeb1ff`, 02:56:44 UTC), the candidate Morpho market still had 10 USDG supply, 9 USDG borrow, and **1 USDG shared free liquidity**. Fresh `/rhj/assets` still returned 194 assets and **zero chain-46630 deployments**; the candidate market oracle remained unverified in Blockscout. Faucet delivery resolves token availability for those observed wallets, **not** issuer-registry identity, independent collateral/loan price feeds, oracle trust, usable vault yield, or owner signing authority. The official RPC's `finalized` height had not reached either receipt during this observation.

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

### Live contract, verified 2026-09-23

`@crest/robinhood` validates these responses. Live payloads differ from the reference page, so the schemas are strict only on consumed fields:

- `/assets` returns 195 active assets; entries add `isin`, `tokenDecimals`, and deployment `networkName`/`itnEnabled`/`atomicEnabled`, and `tradingCapabilities` is shaped `{ market, extended, overnight } × { whole, fractional }`, not the documented three flat fields. Crest reads none of `tradingCapabilities`.
- `id` is `0x` plus 64 hex characters (a `bytes32`), equal to the token's onchain `uid()`; AAPL is `0x…c2425be3658540dd8e2424cbf3c5c649`.
- `currentMultiplier` for AAPL (`1.000566080061092436`) equals onchain `uiMultiplier()` exactly; a mismatch is `conflict` and the onchain value wins.
- `/prices/{symbol}` adds `dailyHigh`, `dailyLow`, and mint/burn volumes; `generatedAt` carries nanosecond precision. Cache windows are documented only for `/prices` (15 s) and `/corporate-actions` (1 h); `/assets` documents none, so its freshness budget is Crest policy.
- `/corporate-actions` returns the 50 most recent rows with no pagination token. An empty list for a token means no action in that window, not no history.
- An unknown symbol returns `404 {"code":5,"message":"no whitelisted asset…"}`; an unknown query field returns `400`.

## 4. Stock Token contract and oracle semantics

Current official documentation describes UI multiplier and pause-related reads. The selected token/feed behavior must be verified against its deployed code and official source.

### Double-adjustment trap

The Stock Token onchain price feed may already include the UI multiplier. Therefore:

- use exact market-oracle semantics for Morpho value;
- never multiply a multiplier-adjusted feed again;
- keep raw token balance, UI-equivalent display, and oracle valuation as separate typed values;
- store token, feed, multiplier, and WAD scales explicitly.

`oraclePaused()` is advisory. `false` does not replace feed freshness/round/sequencer checks; `true` means degraded, not price zero.

### Verified market-oracle composition (2026-09-23)

The reviewed market's oracle (`StaticOracle` `0xD625…E097`, `SCALE_FACTOR` `1e24`) exposes no feed getters, so its composition was established from exact reads at Robinhood block `70212238`:

```text
price()                        339917537895501582692865356
AAPL/USD feed answer (8 dp)    33974221248
USDG/USD feed answer (8 dp)    100005000
AAPL uiMultiplier()            1000566080061092436
1e24 × a / q                   339725226218689065546722663   (feed only)
1e24 × a × m / (1e18 × q)      339917537895501582693298136   (feed × multiplier, agrees to 1.3e-21)
```

Robinhood and Chainlink both document that the AAPL/USD feed already includes the multiplier. This market oracle multiplies it by `uiMultiplier()` again, so Morpho currently values AAPL collateral about 0.057% above the Chainlink total-return price, and the gap grows with every dividend or split. Crest cannot change this: the market oracle stays Morpho's liquidation authority and Crest uses it for LTV, health, and owner-borrow capacity. Crest's own valuation (`stockTokenValues`) never applies the multiplier to the feed, and `@crest/risk` classifies the composition on every assessment: an `unexplained` composition, or a feed-only divergence above the policy's `maxOracleDivergenceBps`, is `oracle_divergence`, which zeroes capacity and freezes borrowing when the oracle trigger is on. The live smoke at block `70226651` reproduced `feed_times_multiplier`.

### Sequencer liveness

Chainlink publishes no L2 Sequencer Uptime Feed for Robinhood Chain and has stopped adding networks (Chainlink L2 Sequencer Uptime Feeds page, 2026-09-23). `@crest/chain` therefore judges liveness by head freshness: `pinBlock` marks every observation `head_lag` when the head timestamp trails the wall clock beyond budget. Feed staleness is judged against the pinned block timestamp and the Chainlink directory heartbeat (`86400` s for both `Robinhood AAPL / USD` and `USDG / USD`, 0.5% deviation). Tokenized-equity feeds do not publish off-hours, so weekend reads are correctly stale.

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

Vault V2 returns zero from all four ERC-4626 max functions by design, so `maxWithdraw` is never read. `@crest/vault` reproduces `VaultV2Liquidity.sol` exactly:

```text
vault capacity       = idle loan-token balance
                     + min(adapter expectedSupplyAssets, market supply − borrow, Morpho loan balance)
                       (adapter term is zero if any of the three accounting allocations is zero,
                        or if the liquidity adapter or liquidity data drifted from the reviewed route)
quoted strategy      = convertToAssets(accountShares)
available            = 0 if a gate refuses the account, else min(quoted strategy, vault capacity)
actionable repayment = min(available, successful simulation, policy bounds)
```

Vault TVL, displayed APY, or `previewRedeem` alone is not actionable liquidity. At block `70226651` the vault held 497.6M USDG but only 33.75M was withdrawable through the normal path.

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

### Verified sources (2026-09-23)

| Fact | Source | Convention and window | Freshness signal |
|---|---|---|---|
| Market borrow APY | `GET /v0/blue/markets/{chain}:{id}/apy-averages` | `apy-compounded`; `24h`, `7d`, `30d`, `90d`, `1y` (null until computed) | `last_indexed_block` vs pinned head |
| Vault native APY | `GET /v1/vaults-v2/{chain}:{vault}/apy-averages?lookback=` | `apy-compounded`; `one_hour` … `one_year`, `inception`; **defaults to `six_hours` when omitted** | `last_indexed_block` vs pinned head |
| Current borrow rate | IRM `borrowRateView` with zero elapsed time | `apr-simple`, `instant`, onchain | pinned block |
| Vault fees | Vault V2 `performanceFee()`, `managementFee()` | fraction and per-second WAD; the REST vault endpoint returns `null` for both, so onchain is authoritative | pinned block |
| Incentives | GraphQL `vaultV2ByAddress.rewards`, `marketById.state.rewards` | `apr-simple` per token and side; both empty on this route | none exposed |

`comparability()` refuses to net two rates whose convention or window differs. The manifest's recorded vault rate uses the default six-hour window while the borrow rate uses one day; netting them is a `window_mismatch`. A carry figure must use `lookback=one_day` against `24h`.

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
- refresh policy nonce, freeze, accrued debt, reserve, vault shares/assets, and currently withdrawable vault assets (never `maxWithdraw`, which Vault V2 fixes at zero);
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
| Vault APY falls | Spread inversion | Below the policy spread: no new debt. Negative marginal spread: freeze, exit toward debt |
| Withdrawable vault liquidity falls | Repayment liquidity lower | Partial bounded repay; alert |
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
