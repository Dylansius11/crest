// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Id, Market, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {MathLib} from "morpho-blue/src/libraries/MathLib.sol";
import {SharesMathLib} from "morpho-blue/src/libraries/SharesMathLib.sol";
import {MockIrm} from "./MockIrm.sol";
import {MockToken} from "./MockToken.sol";

/// @dev Narrow Morpho model. It preserves Morpho's virtual-share and repay-rounding semantics.
contract MockMorpho {
    using MathLib for uint256;
    using SharesMathLib for uint256;
    using SafeERC20 for IERC20;

    error MarketNotConfigured();
    error MarketMismatch();
    error Unauthorized();
    error InvalidAmount();
    error InsufficientLiquidity();

    MarketParams internal _marketParams;
    bool public marketConfigured;
    mapping(Id id => Market marketState) internal _markets;
    mapping(Id id => mapping(address account => Position positionState)) internal _positions;

    function configureMarket(MarketParams calldata marketParams) external {
        _marketParams = marketParams;
        marketConfigured = true;
        _markets[_id(marketParams)].lastUpdate = uint128(block.timestamp);
    }

    function id(MarketParams memory marketParams) external pure returns (Id) {
        return _id(marketParams);
    }

    function seedLiquidity(uint256 assets) external {
        _requireConfigured();
        Id id_ = _id(_marketParams);
        MockToken(_marketParams.loanToken).mint(address(this), assets);
        Market storage market_ = _markets[id_];
        market_.totalSupplyAssets += uint128(assets);
        market_.totalSupplyShares += uint128(assets * 1e6);
    }

    function setMarketState(
        uint256 totalSupplyAssets,
        uint256 totalSupplyShares,
        uint256 totalBorrowAssets,
        uint256 totalBorrowShares
    ) external {
        _requireConfigured();
        _markets[_id(_marketParams)] = Market({
            totalSupplyAssets: uint128(totalSupplyAssets),
            totalSupplyShares: uint128(totalSupplyShares),
            totalBorrowAssets: uint128(totalBorrowAssets),
            totalBorrowShares: uint128(totalBorrowShares),
            lastUpdate: uint128(block.timestamp),
            fee: 0
        });
    }

    function setPosition(address account, uint256 supplyShares, uint256 borrowShares, uint256 collateralAssets)
        external
    {
        _requireConfigured();
        _positions[_id(_marketParams)][account] = Position({
            supplyShares: supplyShares, borrowShares: uint128(borrowShares), collateral: uint128(collateralAssets)
        });
    }

    function accrueInterest(MarketParams memory marketParams) public {
        Id id_ = _requireMarket(marketParams);
        Market storage market_ = _markets[id_];
        uint256 elapsed = block.timestamp - market_.lastUpdate;
        if (elapsed != 0 && market_.totalBorrowAssets != 0 && marketParams.irm != address(0)) {
            uint256 rate = MockIrm(marketParams.irm).borrowRateView(marketParams, market_);
            uint256 interest = uint256(market_.totalBorrowAssets).wMulDown(rate.wTaylorCompounded(elapsed));
            market_.totalBorrowAssets += uint128(interest);
            market_.totalSupplyAssets += uint128(interest);
        }
        market_.lastUpdate = uint128(block.timestamp);
    }

    function position(Id id_, address account) external view returns (Position memory) {
        return _positions[id_][account];
    }

    function market(Id id_) external view returns (Market memory) {
        return _markets[id_];
    }

    function supplyCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, bytes calldata)
        external
    {
        Id id_ = _requireMarket(marketParams);
        IERC20(marketParams.collateralToken).safeTransferFrom(msg.sender, address(this), assets);
        _positions[id_][onBehalf].collateral += uint128(assets);
    }

    function withdrawCollateral(MarketParams memory marketParams, uint256 assets, address onBehalf, address receiver)
        external
    {
        Id id_ = _requireMarket(marketParams);
        if (msg.sender != onBehalf) revert Unauthorized();
        _positions[id_][onBehalf].collateral -= uint128(assets);
        IERC20(marketParams.collateralToken).safeTransfer(receiver, assets);
    }

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256) {
        Id id_ = _requireMarket(marketParams);
        if (msg.sender != onBehalf) revert Unauthorized();
        if ((assets == 0) == (shares == 0)) revert InvalidAmount();
        accrueInterest(marketParams);
        Market storage market_ = _markets[id_];
        if (assets == 0) assets = shares.toAssetsDown(market_.totalBorrowAssets, market_.totalBorrowShares);
        else shares = assets.toSharesUp(market_.totalBorrowAssets, market_.totalBorrowShares);
        if (assets > IERC20(marketParams.loanToken).balanceOf(address(this))) revert InsufficientLiquidity();
        market_.totalBorrowAssets += uint128(assets);
        market_.totalBorrowShares += uint128(shares);
        _positions[id_][onBehalf].borrowShares += uint128(shares);
        IERC20(marketParams.loanToken).safeTransfer(receiver, assets);
        return (assets, shares);
    }

    function repay(MarketParams memory marketParams, uint256 assets, uint256 shares, address onBehalf, bytes calldata)
        external
        returns (uint256, uint256)
    {
        Id id_ = _requireMarket(marketParams);
        if ((assets == 0) == (shares == 0)) revert InvalidAmount();
        accrueInterest(marketParams);
        Market storage market_ = _markets[id_];
        if (assets == 0) assets = shares.toAssetsUp(market_.totalBorrowAssets, market_.totalBorrowShares);
        else shares = assets.toSharesDown(market_.totalBorrowAssets, market_.totalBorrowShares);
        _positions[id_][onBehalf].borrowShares -= uint128(shares);
        market_.totalBorrowShares -= uint128(shares);
        market_.totalBorrowAssets = uint128(assets > market_.totalBorrowAssets ? 0 : market_.totalBorrowAssets - assets);
        IERC20(marketParams.loanToken).safeTransferFrom(msg.sender, address(this), assets);
        return (assets, shares);
    }

    function _requireConfigured() internal view {
        if (!marketConfigured) revert MarketNotConfigured();
    }

    function _requireMarket(MarketParams memory marketParams) internal view returns (Id id_) {
        _requireConfigured();
        id_ = _id(marketParams);
        if (Id.unwrap(id_) != Id.unwrap(_id(_marketParams))) revert MarketMismatch();
    }

    function _id(MarketParams memory marketParams) internal pure returns (Id) {
        return Id.wrap(keccak256(abi.encode(marketParams)));
    }
}
