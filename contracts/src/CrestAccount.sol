// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMorpho, MarketParams, Position, Id} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MorphoBalancesLib} from "morpho-blue/src/libraries/periphery/MorphoBalancesLib.sol";
import {SharesMathLib} from "morpho-blue/src/libraries/SharesMathLib.sol";
import {VaultV2Liquidity} from "./libraries/VaultV2Liquidity.sol";

/// @notice One owner-approved debt position and one fixed loan-token strategy. Not upgradeable.
/// @dev Only standard, manifest-qualified tokens and the qualified native Vault V2 route are supported.
contract CrestAccount is Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SharesMathLib for uint256;

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

    error Unauthorized();
    error InvalidConfiguration();
    error LtvPolicyInvalid();
    error BorrowingIsFrozen();
    error ActivePositionOrBalance();
    error RepayAmountZero();
    error InsufficientVaultShares(uint256 minimum, uint256 actual);
    error ExcessiveVaultShares(uint256 maximum, uint256 actual);
    error CollateralCapExceeded(uint256 cap, uint256 resulting);
    error DebtCeilingExceeded(uint256 cap, uint256 resulting);
    error StrategyCapExceeded(uint256 cap, uint256 resulting);
    error ReserveFloorViolation(uint256 floor, uint256 resulting);
    error StrategyFloorViolation(uint256 floor, uint256 resulting);
    error VaultAssetMismatch(address expected, address actual);
    error PostconditionFailed();

    event PolicyConfigured(
        uint64 indexed policyNonce, bytes32 indexed marketId, address indexed yieldVault, bytes32 policyHash
    );
    event GuardianChanged(address indexed oldGuardian, address indexed newGuardian);
    event BorrowingFrozen(address indexed actor, uint64 indexed policyNonce);
    event BorrowingUnfrozen(address indexed owner, uint64 indexed policyNonce);
    event CollateralSupplied(uint256 assets, uint256 resultingCollateral);
    event BorrowedAndDeployed(
        uint256 borrowedAssets, uint256 vaultShares, uint256 debtAfter, uint256 strategyAssetsAfter
    );
    event StrategyDeposited(uint256 assets, uint256 shares, uint256 strategyAssetsAfter);
    event OwnerRepaid(uint256 repaidAssets, uint256 debtBefore, uint256 debtAfter);
    event RepaidFromReserve(
        address indexed actor, uint256 requestedAssets, uint256 repaidAssets, uint256 debtBefore, uint256 debtAfter
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
    event VaultLiquidityRouteBound(address indexed adapter, bytes32 dataHash);

    IMorpho public immutable morpho;
    bytes32 public marketId;
    uint64 public policyNonce;
    bool public borrowingFrozen;
    address public vaultLiquidityAdapter;
    bytes32 public vaultLiquidityDataHash;
    PolicyConfig private _policy;

    constructor(address initialOwner, address morpho_) Ownable(initialOwner) {
        if (morpho_.code.length == 0) revert InvalidConfiguration();
        morpho = IMorpho(morpho_);
    }

    modifier onlyOwnerOrGuardian() {
        if (msg.sender != owner() && msg.sender != _policy.guardian) revert Unauthorized();
        _;
    }

    modifier configured() {
        if (policyNonce == 0) revert InvalidConfiguration();
        _;
    }

    function guardian() public view returns (address) {
        return _policy.guardian;
    }

    function loanToken() public view returns (address) {
        return _policy.market.loanToken;
    }

    function collateralToken() public view returns (address) {
        return _policy.market.collateralToken;
    }

    function yieldVault() public view returns (address) {
        return _policy.yieldVault;
    }

    function policy() external view returns (PolicyConfig memory) {
        return _policy;
    }

    function configure(PolicyConfig calldata c) external onlyOwner nonReentrant {
        bytes32 nextId = keccak256(abi.encode(c.market));
        if (policyNonce != 0 && (nextId != marketId || c.yieldVault != yieldVault()) && _active()) {
            revert ActivePositionOrBalance();
        }
        if (
            c.market.loanToken.code.length == 0 || c.market.collateralToken.code.length == 0
                || c.market.oracle.code.length == 0 || c.market.irm.code.length == 0
                || c.market.loanToken == c.market.collateralToken || c.yieldVault.code.length == 0
                || c.guardian == owner() || (c.guardian != address(0) && c.maxRepayPerActionAssets == 0)
                || c.strategyFloorAssets > c.maxStrategyAssets || c.market.lltv > 1e18
                || morpho.market(Id.wrap(nextId)).lastUpdate == 0
        ) revert InvalidConfiguration();
        if (!(c.lowerLtvWad < c.targetLtvWad && c.targetLtvWad < c.upperLtvWad && c.upperLtvWad < c.criticalLtvWad
                    && c.criticalLtvWad < c.market.lltv)) revert LtvPolicyInvalid();
        address asset = IERC4626(c.yieldVault).asset();
        if (asset != c.market.loanToken) revert VaultAssetMismatch(c.market.loanToken, asset);
        (address adapter, bytes32 dataHash) =
            VaultV2Liquidity.validate(c.yieldVault, c.market.loanToken, address(morpho));
        address previousGuardian = guardian();
        _policy = c;
        marketId = nextId;
        vaultLiquidityAdapter = adapter;
        vaultLiquidityDataHash = dataHash;
        ++policyNonce;
        morpho.accrueInterest(c.market);
        _checkCollateralCap();
        _checkDebtCeiling(currentDebtAssets());
        _checkStrategyCap();
        emit GuardianChanged(previousGuardian, c.guardian);
        emit VaultLiquidityRouteBound(adapter, dataHash);
        _emitPolicy();
    }

    function setGuardian(address newGuardian) external onlyOwner nonReentrant configured {
        if (newGuardian == owner() || (newGuardian != address(0) && _policy.maxRepayPerActionAssets == 0)) {
            revert InvalidConfiguration();
        }
        address oldGuardian = guardian();
        _policy.guardian = newGuardian;
        ++policyNonce;
        emit GuardianChanged(oldGuardian, newGuardian);
        _emitPolicy();
    }

    function transferOwnership(address newOwner) public override onlyOwner nonReentrant {
        if (newOwner != address(0) && newOwner == guardian()) revert InvalidConfiguration();
        super.transferOwnership(newOwner);
    }

    function acceptOwnership() public override nonReentrant {
        if (msg.sender == guardian()) revert InvalidConfiguration();
        super.acceptOwnership();
    }

    /// @dev Irrecoverable owner loss would strand the account; revocation uses setGuardian(0).
    function renounceOwnership() public view override onlyOwner {
        revert InvalidConfiguration();
    }

    function freezeBorrowing() external onlyOwnerOrGuardian nonReentrant configured {
        borrowingFrozen = true;
        emit BorrowingFrozen(msg.sender, policyNonce);
    }

    function unfreezeBorrowing() external onlyOwner nonReentrant configured {
        borrowingFrozen = false;
        emit BorrowingUnfrozen(msg.sender, policyNonce);
    }

    function supplyCollateral(uint256 assets) external onlyOwner nonReentrant configured {
        _requireAmount(assets);
        IERC20 token = IERC20(collateralToken());
        _pull(token, assets);
        token.forceApprove(address(morpho), assets);
        morpho.supplyCollateral(_policy.market, assets, address(this), "");
        token.forceApprove(address(morpho), 0);
        emit CollateralSupplied(assets, _checkCollateralCap());
    }

    function borrowAndDeploy(uint256 assets, uint256 minVaultShares) external onlyOwner nonReentrant configured {
        if (borrowingFrozen) revert BorrowingIsFrozen();
        _requireAmount(assets);
        morpho.accrueInterest(_policy.market);
        _checkDebtCeiling(currentDebtAssets() + assets);
        uint256 beforeBalance = idleReserveAssets();
        (uint256 borrowed,) = morpho.borrow(_policy.market, assets, 0, address(this), address(this));
        if (borrowed != assets || idleReserveAssets() != beforeBalance + assets) revert PostconditionFailed();
        uint256 shares = _deposit(assets, minVaultShares);
        uint256 debt = currentDebtAssets();
        _checkDebtCeiling(debt);
        emit BorrowedAndDeployed(assets, shares, debt, strategyAssets());
    }

    function depositToStrategy(uint256 assets, uint256 minVaultShares) external onlyOwner nonReentrant configured {
        _requireAmount(assets);
        _pull(IERC20(loanToken()), assets);
        uint256 shares = _deposit(assets, minVaultShares);
        emit StrategyDeposited(assets, shares, strategyAssets());
    }

    function ownerRepay(uint256 assets) external onlyOwner nonReentrant configured {
        uint256 debtBefore = _accrueDebt();
        uint256 amount = Math.min(assets, debtBefore);
        if (amount == 0) revert RepayAmountZero();
        _pull(IERC20(loanToken()), amount);
        uint256 debtAfter = _repay(amount, debtBefore);
        emit OwnerRepaid(amount, debtBefore, debtAfter);
    }

    function repayFromReserve(uint256 requestedAssets) external onlyOwnerOrGuardian nonReentrant configured {
        uint256 debtBefore = _accrueDebt();
        uint256 amount = Math.min(
            Math.min(requestedAssets, _policy.maxRepayPerActionAssets),
            Math.min(_aboveFloor(idleReserveAssets(), _policy.reserveFloorAssets), debtBefore)
        );
        if (amount == 0) revert RepayAmountZero();
        uint256 debtAfter = _repay(amount, debtBefore);
        _checkReserveFloor();
        emit RepaidFromReserve(msg.sender, requestedAssets, amount, debtBefore, debtAfter);
    }

    function repayFromStrategy(uint256 requestedAssets) external onlyOwnerOrGuardian nonReentrant configured {
        uint256 debtBefore = _accrueDebt();
        uint256 strategyBefore = strategyAssets();
        uint256 amount = Math.min(
            Math.min(requestedAssets, _policy.maxRepayPerActionAssets),
            Math.min(
                debtBefore,
                Math.min(maxWithdrawableStrategyAssets(), _aboveFloor(strategyBefore, _policy.strategyFloorAssets))
            )
        );
        if (amount == 0) revert RepayAmountZero();
        uint256 reserveBefore = idleReserveAssets();
        uint256 shares = IERC4626(yieldVault()).withdraw(amount, address(this), address(this));
        if (idleReserveAssets() != reserveBefore + amount) revert PostconditionFailed();
        _checkStrategyFloor();
        uint256 debtAfter = _repay(amount, debtBefore);
        if (idleReserveAssets() != reserveBefore) revert PostconditionFailed();
        emit RepaidFromStrategy(
            msg.sender, requestedAssets, amount, shares, debtBefore, debtAfter, strategyBefore, strategyAssets()
        );
    }

    function withdrawCollateral(uint256 assets, address receiver) external onlyOwner nonReentrant configured {
        _requireWithdrawal(assets, receiver);
        morpho.withdrawCollateral(_policy.market, assets, address(this), receiver);
        emit CollateralWithdrawn(assets, receiver);
    }

    function withdrawLoanToken(uint256 assets, address receiver) external onlyOwner nonReentrant configured {
        _requireWithdrawal(assets, receiver);
        IERC20(loanToken()).safeTransfer(receiver, assets);
        _checkReserveFloor();
        emit LoanTokenWithdrawn(assets, receiver);
    }

    function withdrawStrategy(uint256 assets, address receiver, uint256 maxShares)
        external
        onlyOwner
        nonReentrant
        configured
    {
        _requireWithdrawal(assets, receiver);
        uint256 shares = IERC4626(yieldVault()).withdraw(assets, receiver, address(this));
        if (shares > maxShares) revert ExcessiveVaultShares(maxShares, shares);
        emit StrategyWithdrawn(assets, shares, receiver);
    }

    function currentDebtAssets() public view returns (uint256) {
        if (policyNonce == 0) return 0;
        // Use the public position selector, not extSloads: identical audited virtual-share rounding.
        uint256 shares = morpho.position(Id.wrap(marketId), address(this)).borrowShares;
        (,, uint256 assets, uint256 totalShares) = MorphoBalancesLib.expectedMarketBalances(morpho, _policy.market);
        return shares.toAssetsUp(assets, totalShares);
    }

    function idleReserveAssets() public view returns (uint256) {
        return policyNonce == 0 ? 0 : IERC20(loanToken()).balanceOf(address(this));
    }

    function strategyAssets() public view returns (uint256) {
        if (policyNonce == 0) return 0;
        IERC4626 vault = IERC4626(yieldVault());
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }

    function maxWithdrawableStrategyAssets() public view returns (uint256) {
        if (policyNonce == 0) return 0;
        return VaultV2Liquidity.available(
            yieldVault(), address(this), address(morpho), vaultLiquidityAdapter, vaultLiquidityDataHash
        );
    }

    function _deposit(uint256 assets, uint256 minimum) private returns (uint256 shares) {
        (address adapter, bytes32 dataHash) = VaultV2Liquidity.validate(yieldVault(), loanToken(), address(morpho));
        if (adapter != vaultLiquidityAdapter || dataHash != vaultLiquidityDataHash) revert InvalidConfiguration();
        IERC4626 vault = IERC4626(yieldVault());
        IERC20 token = IERC20(loanToken());
        uint256 sharesBefore = vault.balanceOf(address(this));
        uint256 balanceBefore = token.balanceOf(address(this));
        token.forceApprove(address(vault), assets);
        shares = vault.deposit(assets, address(this));
        token.forceApprove(address(vault), 0);
        if (shares == 0 || shares < minimum) revert InsufficientVaultShares(minimum, shares);
        if (
            vault.balanceOf(address(this)) != sharesBefore + shares
                || token.balanceOf(address(this)) != balanceBefore - assets
        ) {
            revert PostconditionFailed();
        }
        _checkStrategyCap();
    }

    function _repay(uint256 amount, uint256 debtBefore) private returns (uint256 debtAfter) {
        IERC20 token = IERC20(loanToken());
        uint256 beforeBalance = token.balanceOf(address(this));
        // Full repayment by shares avoids leaving virtual-share rounding dust or over-repaying.
        uint256 shares = amount == debtBefore ? morpho.position(Id.wrap(marketId), address(this)).borrowShares : 0;
        token.forceApprove(address(morpho), amount);
        (uint256 repaid,) = morpho.repay(_policy.market, shares == 0 ? amount : 0, shares, address(this), "");
        token.forceApprove(address(morpho), 0);
        debtAfter = currentDebtAssets();
        if (repaid != amount || token.balanceOf(address(this)) != beforeBalance - amount || debtAfter >= debtBefore) {
            revert PostconditionFailed();
        }
    }

    function _pull(IERC20 token, uint256 assets) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), assets);
        if (token.balanceOf(address(this)) != beforeBalance + assets) revert PostconditionFailed();
    }

    function _accrueDebt() private returns (uint256) {
        morpho.accrueInterest(_policy.market);
        return currentDebtAssets();
    }

    function _active() private view returns (bool) {
        Position memory position = morpho.position(Id.wrap(marketId), address(this));
        // Unsolicited Morpho supply shares are not part of Crest's borrowing position and cannot be recovered here.
        return position.collateral != 0 || position.borrowShares != 0 || idleReserveAssets() != 0
            || IERC4626(yieldVault()).balanceOf(address(this)) != 0;
    }

    function _checkCollateralCap() private view returns (uint256 assets) {
        assets = morpho.position(Id.wrap(marketId), address(this)).collateral;
        if (assets > _policy.maxCollateralAssets) revert CollateralCapExceeded(_policy.maxCollateralAssets, assets);
    }

    function _checkDebtCeiling(uint256 debt) private view {
        if (debt > _policy.debtCeilingAssets) revert DebtCeilingExceeded(_policy.debtCeilingAssets, debt);
    }

    function _checkStrategyCap() private view {
        uint256 assets = strategyAssets();
        if (assets > _policy.maxStrategyAssets) revert StrategyCapExceeded(_policy.maxStrategyAssets, assets);
    }

    function _checkReserveFloor() private view {
        uint256 assets = idleReserveAssets();
        if (assets < _policy.reserveFloorAssets) revert ReserveFloorViolation(_policy.reserveFloorAssets, assets);
    }

    function _checkStrategyFloor() private view {
        uint256 assets = strategyAssets();
        if (assets < _policy.strategyFloorAssets) revert StrategyFloorViolation(_policy.strategyFloorAssets, assets);
    }

    function _aboveFloor(uint256 assets, uint256 floor) private pure returns (uint256) {
        return assets > floor ? assets - floor : 0;
    }

    function _requireAmount(uint256 assets) private pure {
        if (assets == 0) revert InvalidConfiguration();
    }

    function _requireWithdrawal(uint256 assets, address receiver) private view {
        _requireAmount(assets);
        if (receiver == address(0) || receiver == address(this)) revert InvalidConfiguration();
    }

    function _emitPolicy() private {
        emit PolicyConfigured(policyNonce, marketId, yieldVault(), keccak256(abi.encode(_policy)));
    }
}
