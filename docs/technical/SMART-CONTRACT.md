# Crest Smart-Contract Specification

**MVP contract:** one non-upgradeable `CrestAccount`
**External protocols:** one verified Morpho deployment and one verified loan-token vault
**Deployment:** Robinhood Chain after exact route verification
**Guardian scope:** freeze plus bounded own-debt repayment; no debt creation

## 1. Contract decision

Use a small purpose-built account. Do not use a generic smart account or executor.

The Crest Account owns one Morpho position, its idle loan-token reserve, and shares in one fixed loan-token vault. The owner alone creates debt and withdraws value. Crest Guardian may only freeze or move account-owned loan-token liquidity from reserve/fixed vault into repayment of the account's own debt.

This surface is intentionally asymmetric:

- upside leverage requires owner consent;
- downside repayment may be automated;
- every Guardian value path ends at the account's exact Morpho debt;
- no Guardian receiver, venue, target, calldata, or approval choice exists.

## 2. External interfaces

### 2.1 Morpho

```solidity
struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}
```

Market ID is `keccak256(abi.encode(params))` according to the verified Morpho implementation/SDK.

Required operations:

```solidity
function accrueInterest(MarketParams memory params) external;
function position(bytes32 id, address user)
    external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
function market(bytes32 id)
    external view returns (
        uint128 totalSupplyAssets,
        uint128 totalSupplyShares,
        uint128 totalBorrowAssets,
        uint128 totalBorrowShares,
        uint128 lastUpdate,
        uint128 fee
    );
function supplyCollateral(MarketParams memory p, uint256 assets, address onBehalf, bytes memory data) external;
function borrow(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, address receiver)
    external returns (uint256, uint256);
function repay(MarketParams memory p, uint256 assets, uint256 shares, address onBehalf, bytes memory data)
    external returns (uint256, uint256);
function withdrawCollateral(MarketParams memory p, uint256 assets, address onBehalf, address receiver) external;
```

### 2.2 Fixed yield vault

The selected route is native Morpho Vault V2. Its ERC-4626 `max*` functions deliberately return zero; they are observations, not exit-liquidity limits for this generation.

```solidity
interface IERC4626Like {
    function asset() external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function previewDeposit(uint256 assets) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function maxDeposit(address receiver) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
}
```

`VaultV2Liquidity` is a read-only library over the manifest-qualified native vault and MorphoMarketV1AdapterV2, not a custody or routing adapter. Configuration snapshots `liquidityAdapter` and `keccak256(liquidityData)`. New deposits reject route drift until owner reconfiguration; Guardian strategy capacity becomes zero on drift. No alternate adapter, forced deallocation, or in-kind redemption is exposed.

## 3. State

```solidity
contract CrestAccount {
    address public owner;
    address public pendingOwner;
    address public immutable morpho;

    address public guardian;
    bool public borrowingFrozen;

    MarketParams internal marketParams;
    bytes32 public marketId;
    address public collateralToken;
    address public loanToken;
    address public yieldVault;

    uint128 public maxCollateralAssets;
    uint128 public debtCeilingAssets;
    uint128 public maxStrategyAssets;
    uint128 public reserveFloorAssets;
    uint128 public strategyFloorAssets;
    uint128 public maxRepayPerActionAssets;

    uint64 public lowerLtvWad;
    uint64 public targetLtvWad;
    uint64 public upperLtvWad;
    uint64 public criticalLtvWad;
    uint64 public policyNonce;
}
```

Exact storage widths are implementation decisions after range analysis. Policy values may use a packed configuration struct, but the public view/event must expose every value losslessly.

One market and one vault per account. Multi-market and multi-vault support use later contracts/coordinators, not mappings added to MVP.

## 4. Roles

### Owner

May:

- configure exact market, vault, caps, floors, LTV band, and Guardian;
- supply collateral;
- borrow through `borrowAndDeploy`;
- deposit owner-provided loan token into the fixed vault;
- make owner repayments;
- withdraw collateral, idle loan token, or vault assets subject to protocol/policy;
- freeze or unfreeze;
- revoke/change Guardian;
- transfer ownership through two-step acceptance.

### Crest Guardian

May only:

- set `borrowingFrozen = true`;
- call `repayFromReserve(uint256)`;
- call `repayFromStrategy(uint256)`.

Guardian cannot unfreeze, borrow, withdraw to a receiver, transfer, swap, sell collateral, select a vault, change approvals, change policy, or change roles.

## 5. Public interface

```solidity
interface ICrestAccount {
    struct PolicyConfig {
        MarketParams market;
        address yieldVault;
        uint128 maxCollateralAssets;
        uint128 debtCeilingAssets;
        uint128 maxStrategyAssets;
        uint128 reserveFloorAssets;
        uint128 strategyFloorAssets;
        uint128 maxRepayPerActionAssets;
        uint64 lowerLtvWad;
        uint64 targetLtvWad;
        uint64 upperLtvWad;
        uint64 criticalLtvWad;
        address guardian;
    }

    function configure(PolicyConfig calldata config) external;
    function setGuardian(address newGuardian) external;
    function freezeBorrowing() external;
    function unfreezeBorrowing() external;

    function supplyCollateral(uint256 assets) external;
    function borrowAndDeploy(uint256 assets, uint256 minVaultShares) external;
    function depositToStrategy(uint256 assets, uint256 minVaultShares) external;
    function ownerRepay(uint256 assets) external;
    function repayFromReserve(uint256 requestedAssets) external;
    function repayFromStrategy(uint256 requestedAssets) external;
    function withdrawCollateral(uint256 assets, address receiver) external;
    function withdrawLoanToken(uint256 assets, address receiver) external;
    function withdrawStrategy(uint256 assets, address receiver, uint256 maxShares) external;

    function currentDebtAssets() external view returns (uint256);
    function idleReserveAssets() external view returns (uint256);
    function strategyAssets() external view returns (uint256);
    function maxWithdrawableStrategyAssets() external view returns (uint256);
    function policy() external view returns (PolicyConfig memory);
}
```

If safe active-position reconfiguration makes one `configure` too ambiguous, split it into explicit owner-only functions. Market, tokens, Morpho address, or vault cannot change while collateral, debt, reserve, or vault shares remain.

The immutable Morpho deployment never changes. Unsupported, unsolicited Morpho supply shares do not lock route reuse: third parties can donate them, and Crest exposes no lending-position recovery path. The supported collateral, borrow shares, idle reserve, and vault shares each independently lock market/vault changes. Owner/Guardian role collapse and ownership renunciation are rejected; Guardian zero revokes authority. Configuration and Guardian changes increment `policyNonce` and emit the complete policy hash. The current policy view exposes every field.

## 6. Invariants

### I-1 Exact market

Every Morpho mutation uses stored exact MarketParams and derives the stored market ID.

### I-2 Exact strategy

Every strategy mutation targets the configured vault. `yieldVault.asset()` equals `loanToken`.

### I-3 Borrow freeze

If `borrowingFrozen`, every borrowing path reverts.

### I-4 Owner-only debt creation

Only owner can call `borrowAndDeploy`. There is no Guardian borrow method, signed generic executor, fallback route, or owner-selected receiver for borrowed funds. Morpho sends borrowed assets to Crest Account; the account deposits only into the fixed vault.

### I-5 Collateral cap

After supply, account Morpho collateral is `<= maxCollateralAssets`.

### I-6 Accrued debt ceiling

Before borrow:

1. accrue Morpho interest;
2. convert current borrow shares to assets rounding up;
3. require `currentDebtAssets + requestedAssets <= debtCeilingAssets`;
4. require borrowing is not frozen;
5. borrow exact assets to Crest Account;
6. deposit exact received assets into fixed vault;
7. require minted shares `>= minVaultShares`;
8. require strategy assets `<= maxStrategyAssets`.

The whole transaction reverts if vault deposit fails.

### I-7 Ordered LTV policy

Configuration requires:

```text
lowerLtvWad < targetLtvWad < upperLtvWad < criticalLtvWad < market.lltv
```

Morpho remains the protocol liquidation authority. Guardian triggers use offchain calculations; these onchain values bind the signed policy and future call validation.

### I-8 Reserve floor

Guardian reserve repayment and owner idle-loan-token withdrawal preserve:

```text
remaining idle loan-token balance >= reserveFloorAssets
```

### I-9 Strategy floor

Routine strategy repayment cannot reduce strategy assets below `strategyFloorAssets`. Owner strategy withdrawal may exit below this routine floor; the Guardian cannot override it. Owner idle-loan-token withdrawal still preserves the reserve floor, which the owner can lower through policy configuration before final exit.

### I-10 Repayment cap

Reserve repayment is bounded by:

```text
min(requested, maxRepayPerAction, idleBalance - reserveFloor, currentDebt)
```

Strategy repayment is bounded by:

```text
min(
  requested,
  maxRepayPerAction,
  maxWithdrawableStrategyAssets(),
  strategyAssets - strategyFloor,
  currentDebt
)
```

All subtraction uses non-underflowing saturating logic before the minimum.

### I-11 Fixed repayment destination

`repayFromStrategy` withdraws vault assets with `receiver = address(this)` and `owner = address(this)`, then repays with `onBehalf = address(this)`. It has no receiver, market, vault, or calldata parameter.

### I-12 Debt-decrease postcondition

After either Guardian repayment, fresh accrued debt must be lower than debt before. Otherwise the transaction reverts where reliable or the offchain run is marked failed and borrowing stays frozen.

### I-13 No Guardian extraction

Guardian-accessible paths cannot send value to Guardian or any arbitrary receiver.

### I-14 Guardian cannot unfreeze

`freezeBorrowing()` is owner-or-Guardian; `unfreezeBorrowing()` is owner-only.

### I-15 No arbitrary execution

No delegatecall, arbitrary call, plugin, fallback executor, generic token approval, swap, flash loan, or collateral-sale method.

## 7. Debt and vault accounting

Morpho debt uses fresh borrow shares:

$$
D = \\left\\lceil \\frac{S_u \\times (A_t + 1)}{S_t + 10^6} \\right\\rceil
$$

Use Morpho's audited `toAssetsUp` virtual-share semantics after interest accrual. A full repayment uses all account borrow shares; partial repayment uses assets. If rounding burns no effective debt, the whole repayment reverts. Accrued debt can exceed a policy ceiling passively; the ceiling is enforced at configuration and before/after debt creation, not by hiding interest.

Strategy assets are not a cached principal counter:

```text
strategyAssets = yieldVault.convertToAssets(yieldVault.balanceOf(address(this)))
withdrawable = min(strategyAssets, vaultIdleAssets + executableDefaultAdapterAssets)
```

For the bound native adapter route, executable adapter assets are the minimum of its own rounded-down expected supply assets, the exact market's `totalSupplyAssets - totalBorrowAssets`, and Morpho's physical loan-token balance. Adapter membership, send-share/receive-asset gates, and all three native deallocation allocation IDs must permit exit. Zero allocation cannot contribute liquidity even if residual adapter shares later accrue quoted value. Exact vault withdrawal remains the atomic, reverting execution check; the read is a conservative capacity bound, not a guarantee against all vault failures.

The contract uses actual return values and before/after balances. Offchain code may calculate projected profit, but contract authorization never depends on an unsigned APY.

## 8. Token flows

### Owner borrow and deploy

```text
owner calls borrowAndDeploy(assets, minShares)
→ accrue/read current Morpho debt
→ enforce owner, freeze, debt, and strategy caps
→ Morpho sends loan token to Crest Account
→ exact approval to fixed vault
→ vault deposits for Crest Account
→ reset approval when compatible
→ verify shares/assets and emit complete event
```

Borrowed assets never pass through Guardian or an arbitrary receiver.

### Guardian reserve repayment

```text
Guardian calls repayFromReserve(requested)
→ calculate bounded idle amount above floor
→ exact approval to Morpho
→ repay Crest Account debt
→ verify debt decreased
```

### Guardian strategy repayment

```text
Guardian calls repayFromStrategy(requested)
→ calculate bounded withdrawable amount above strategy floor
→ fixed vault withdraws loan token to Crest Account
→ exact approval to Morpho
→ repay Crest Account debt
→ verify debt decreased and record strategy assets before/after
```

No swap, collateral movement, or external receiver.

## 9. Errors

```solidity
error Unauthorized();
error BorrowingIsFrozen();
error MarketMismatch(bytes32 expected, bytes32 actual);
error VaultMismatch(address expected, address actual);
error VaultAssetMismatch(address expected, address actual);
error CollateralCapExceeded(uint256 cap, uint256 resulting);
error DebtCeilingExceeded(uint256 ceiling, uint256 resulting);
error StrategyCapExceeded(uint256 cap, uint256 resulting);
error ReserveFloorViolation(uint256 floor, uint256 resulting);
error StrategyFloorViolation(uint256 floor, uint256 resulting);
error LtvPolicyInvalid();
error RepayAmountZero();
error InsufficientVaultShares(uint256 minimum, uint256 actual);
error ActivePositionOrBalance();
error InvalidConfiguration();
error PostconditionFailed();
```

Use custom errors for core invariants.

## 10. Events

```solidity
event PolicyConfigured(
    uint64 indexed policyNonce,
    bytes32 indexed marketId,
    address indexed yieldVault,
    bytes32 policyHash
);
event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);
event BorrowingFrozen(address indexed actor, uint64 indexed policyNonce);
event BorrowingUnfrozen(address indexed owner, uint64 indexed policyNonce);
event CollateralSupplied(uint256 assets, uint256 resultingCollateral);
event BorrowedAndDeployed(
    uint256 borrowedAssets,
    uint256 vaultShares,
    uint256 debtAfter,
    uint256 strategyAssetsAfter
);
event StrategyDeposited(uint256 assets, uint256 shares, uint256 strategyAssetsAfter);
event RepaidFromReserve(
    address indexed actor,
    uint256 requestedAssets,
    uint256 repaidAssets,
    uint256 debtBefore,
    uint256 debtAfter
);
event RepaidFromStrategy(
    address indexed actor,
    uint256 requestedAssets,
    uint256 withdrawnAssets,
    uint256 burnedShares,
    uint256 debtBefore,
    uint256 debtAfter,
    uint256 strategyAssetsBefore,
    uint256 strategyAssetsAfter
);
event CollateralWithdrawn(uint256 assets, address indexed receiver);
event LoanTokenWithdrawn(uint256 assets, address indexed receiver);
event StrategyWithdrawn(uint256 assets, uint256 shares, address indexed receiver);
event OwnerRepaid(uint256 repaidAssets, uint256 debtBefore, uint256 debtAfter);
event VaultLiquidityRouteBound(address indexed adapter, bytes32 dataHash);
```

`PolicyConfigured` may emit every policy field directly if that is more indexable; `policyHash` never substitutes for the public policy view.

## 11. Configuration validation

Reject:

- zero Morpho/token/oracle/IRM/vault/Guardian where required;
- derived market ID mismatch or unsupported market;
- `yieldVault.asset() != loanToken`;
- invalid LTV ordering or `criticalLtvWad >= market.lltv`;
- zero repayment cap while Guardian is enabled;
- cap/floor values below current active balances where unsafe;
- market/token/vault change while any active position, idle reserve, or vault share remains;
- vault with incompatible interface/behavior;
- Guardian equal to owner; renouncing ownership is also disabled.

Live liquidity, APY, curator quality, and offchain freshness are onboarding/action gates, not immutable contract facts.

## 12. Security controls

- Pinned Solidity, Morpho, OpenZeppelin, and vault interface dependencies.
- OpenZeppelin `Ownable2Step`, `SafeERC20`, and `ReentrancyGuard` where compatible.
- Checks-effects-interactions and reentrancy protection around vault/Morpho calls.
- Exact temporary approvals; reset after use where token behavior permits.
- Immutable Morpho address; fixed market/vault under active-position lock.
- No proxy for MVP.
- No fee-on-transfer, rebasing, callback-heavy, or non-standard loan token unless exact route proves compatibility.
- Borrowing freeze does not block repayment or owner exit.
- Guardian key has minimal gas and is revocable.
- Vault loss and withdrawal constraints are not hidden by cached accounting.

## 13. Test matrix

### Unit and invariant

- owner/Guardian/stranger permission matrix for every function;
- Guardian can freeze but cannot unfreeze or borrow;
- no fallback/crafted calldata reaches owner paths;
- market and vault identities are fixed;
- vault asset must equal loan token;
- every borrow while frozen reverts;
- collateral, accrued-debt, and strategy caps hold;
- LTV policy ordering holds;
- reserve/strategy floors and repayment cap hold at boundaries;
- Guardian repayment never transfers to Guardian/arbitrary receiver;
- repeated partial repayments never underflow;
- share/asset rounding and slippage bounds;
- debt decreases after successful repayment;
- market/vault cannot change with active state;
- policy nonce and complete event behavior.

### Pinned fork

- exact market and vault deployment/asset/code match manifest;
- collateral supply succeeds;
- owner borrow-and-deploy mints expected minimum shares;
- over-cap and frozen borrow revert;
- accrued debt is used for ceiling;
- generation-appropriate native withdrawal liquidity constrains repayment; for Vault V2, do not interpret zero `maxWithdraw` as zero executable liquidity;
- reserve and strategy repayment reduce debt;
- partial withdrawal/liquidity failure is handled;
- owner exit follows Morpho/vault semantics.

### Fuzz/invariant

- arbitrary owner operations plus Guardian freeze/repay sequences preserve I-1 through I-15;
- amount boundaries around caps/floors/debt/share conversions;
- malicious vault mock cannot redirect receiver or cause Guardian extraction;
- reentrancy attempts through token/vault callbacks fail.

## 14. Post-MVP A contract

Bounded target-LTV borrowing requires a new audited contract version with an EIP-712 `BorrowEnvelope`:

- exact chain/account/market/vault;
- maximum additional debt and per-action/day caps;
- expiry, cooldown, nonce, and revocation;
- LTV band, minimum health, and minimum net spread commitment;
- borrowed funds forced into fixed vault;
- no general signature or arbitrary execution.

Do not add dormant envelope fields or Guardian borrow methods to MVP.

## 15. Post-MVP B contract impact

Prefer one account per isolated Morpho market coordinated offchain. Multiple strategies require independently audited fixed adapters and policy accounting. Do not turn MVP into a mapping-driven universal router.

Collateral sale/unwind remains a separate later contract with fixed venue adapters, min-out/deadline/oracle-deviation checks, atomic ordering, excess handling, MEV analysis, and independent audit.

## 16. Deployment gate

Before testnet funding or owner signatures, qualify the exact 46630 route and deploy a new `CrestAccount` bound to that network's verified Morpho contract. The existing 4663 pinned fork and manifest do not satisfy this gate:

- manifest evidence is genuinely finalized, strictly prior to the validation block, no more than 256 blocks old, and matches canonical `blockhash`;
- exact Morpho market and vault route verified from current sources and bytecode;
- unit/fuzz/invariant suite passes;
- pinned fork completes supply → owner borrow-and-deploy → Guardian freeze → strategy repay → owner exit;
- independent review confirms Guardian call graph and vault receiver;
- source/bytecode verification succeeds;
- small-value canary proves debt decrease and policy constraints;
- dashboard labels projected versus realized economics correctly.

## 17. Sources

- [Morpho core contract API](https://docs.morpho.org/developers/contracts/morpho/)
- [Morpho market mechanics](https://docs.morpho.org/developers/borrow/concepts/market-mechanics/)
- [Morpho LTV and health](https://docs.morpho.org/developers/borrow/concepts/ltv/)
- [ERC-4626](https://eips.ethereum.org/EIPS/eip-4626)
- [Robinhood Chain contracts](https://docs.robinhood.com/chain/contracts/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
