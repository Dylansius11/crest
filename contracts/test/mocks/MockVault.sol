// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockToken} from "./MockToken.sol";

/// @dev V2-shaped vault: all ERC-4626 max functions deliberately return zero.
contract MockVault is ERC20 {
    using SafeERC20 for IERC20;

    error CannotSendShares();
    error CannotReceiveAssets();
    error CannotReceiveShares();
    error WithdrawConstrained(uint256 requested, uint256 available);

    address public immutable asset;
    address public liquidityAdapter;
    bytes public liquidityData;
    uint256 public accountedAssets;
    uint256 public withdrawalLimit = type(uint256).max;
    uint256 public depositShareBps = 10_000;
    bool public sendSharesAllowed = true;
    bool public receiveAssetsAllowed = true;
    bool public receiveSharesAllowed = true;

    constructor(address asset_) ERC20("Mock Vault V2", "mV2") {
        asset = asset_;
    }

    function totalAssets() public view returns (uint256) {
        return accountedAssets;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return Math.mulDiv(shares, totalAssets() + 1, totalSupply() + 1, Math.Rounding.Floor);
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply() + 1, totalAssets() + 1, Math.Rounding.Floor);
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(convertToShares(assets), depositShareBps, 10_000, Math.Rounding.Floor);
    }

    function previewWithdraw(uint256 assets) public view returns (uint256) {
        return Math.mulDiv(assets, totalSupply() + 1, totalAssets() + 1, Math.Rounding.Ceil);
    }

    function maxDeposit(address) external pure returns (uint256) {
        return 0;
    }

    function maxMint(address) external pure returns (uint256) {
        return 0;
    }

    function maxWithdraw(address) external pure returns (uint256) {
        return 0;
    }

    function maxRedeem(address) external pure returns (uint256) {
        return 0;
    }

    function canSendShares(address) external view returns (bool) {
        return sendSharesAllowed;
    }

    function canReceiveAssets(address) external view returns (bool) {
        return receiveAssetsAllowed;
    }

    function canReceiveShares(address) external view returns (bool) {
        return receiveSharesAllowed;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        if (!receiveSharesAllowed) revert CannotReceiveShares();
        shares = previewDeposit(assets);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        accountedAssets += assets;
        _mint(receiver, shares);
    }

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        if (!sendSharesAllowed) revert CannotSendShares();
        if (!receiveAssetsAllowed) revert CannotReceiveAssets();
        uint256 available = _available(owner);
        if (assets > available) revert WithdrawConstrained(assets, available);
        shares = previewWithdraw(assets);
        if (msg.sender != owner) _spendAllowance(owner, msg.sender, shares);
        _burn(owner, shares);
        accountedAssets -= assets;
        IERC20(asset).safeTransfer(receiver, assets);
    }

    function setLiquidityAdapter(address adapter, bytes calldata data) external {
        liquidityAdapter = adapter;
        liquidityData = data;
    }

    function setWithdrawalLimit(uint256 newLimit) external {
        withdrawalLimit = newLimit;
    }

    function setGates(bool sendShares, bool receiveAssets, bool receiveShares) external {
        sendSharesAllowed = sendShares;
        receiveAssetsAllowed = receiveAssets;
        receiveSharesAllowed = receiveShares;
    }

    function setDepositShareBps(uint256 newBps) external {
        require(newBps <= 10_000, "bps");
        depositShareBps = newBps;
    }

    function realizeLoss(uint256 assets) external {
        accountedAssets -= assets;
        MockToken(asset).burn(address(this), assets);
    }

    function donate(uint256 assets) external {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), assets);
        accountedAssets += assets;
    }

    function _available(address owner) internal view returns (uint256) {
        uint256 ownedAssets = convertToAssets(balanceOf(owner));
        uint256 physicalAssets = IERC20(asset).balanceOf(address(this));
        uint256 available = ownedAssets < physicalAssets ? ownedAssets : physicalAssets;
        return available < withdrawalLimit ? available : withdrawalLimit;
    }
}

/// @dev Minimal adapter shape for tests that snapshot a non-idle V2 route.
contract MockLiquidityAdapter {
    uint256 public realAssets;
    uint256 public availableLiquidity;

    function setAssets(uint256 assets, uint256 liquidity) external {
        realAssets = assets;
        availableLiquidity = liquidity;
    }
}
