// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IMorpho, MarketParams, Market, Id} from "morpho-blue/src/interfaces/IMorpho.sol";

/// @dev Narrow selectors from the manifest-verified VaultV2 and MorphoMarketV1AdapterV2 sources.
interface IVaultV2 is IERC4626 {
    function liquidityAdapter() external view returns (address);
    function liquidityData() external view returns (bytes memory);
    function isAdapter(address adapter) external view returns (bool);
    function canSendShares(address account) external view returns (bool);
    function canReceiveAssets(address account) external view returns (bool);
    function allocation(bytes32 id) external view returns (uint256);
}

interface IMarketV1AdapterV2 {
    function parentVault() external view returns (address);
    function asset() external view returns (address);
    function morpho() external view returns (address);
    function adaptiveCurveIrm() external view returns (address);
    function expectedSupplyAssets(bytes32 marketId) external view returns (uint256);
}

/// @notice Read-only native V2 liquidity boundary. Never holds funds, changes allocations or calls max*.
library VaultV2Liquidity {
    error InvalidVaultRoute();

    function validate(address vaultAddress, address loan, address morpho)
        internal
        view
        returns (address adapterAddress, bytes32 dataHash)
    {
        IVaultV2 vault = IVaultV2(vaultAddress);
        if (vaultAddress.code.length == 0 || vault.asset() != loan) revert InvalidVaultRoute();
        adapterAddress = vault.liquidityAdapter();
        bytes memory data = vault.liquidityData();
        dataHash = keccak256(data);
        if (adapterAddress == address(0)) return (adapterAddress, dataHash);
        if (adapterAddress.code.length == 0 || !vault.isAdapter(adapterAddress) || data.length != 160) {
            revert InvalidVaultRoute();
        }
        IMarketV1AdapterV2 adapter = IMarketV1AdapterV2(adapterAddress);
        MarketParams memory market = abi.decode(data, (MarketParams));
        if (
            adapter.parentVault() != vaultAddress || adapter.asset() != loan || adapter.morpho() != morpho
                || market.loanToken != loan || market.irm != adapter.adaptiveCurveIrm()
        ) revert InvalidVaultRoute();
    }

    /// @dev Conservative normal-exit bound, not a promise of execution: withdraw still enforces every vault gate.
    /// Interest increases Morpho supply and borrow assets equally, so their difference needs no rate projection.
    /// No forced deallocation, in-kind redemption, alternate adapter or API-provided amount is accepted.
    function available(
        address vaultAddress,
        address account,
        address morpho,
        address fixedAdapter,
        bytes32 fixedDataHash
    ) internal view returns (uint256) {
        IVaultV2 vault = IVaultV2(vaultAddress);
        bytes memory data = vault.liquidityData();
        if (vault.liquidityAdapter() != fixedAdapter || keccak256(data) != fixedDataHash) return 0;
        if (!vault.canSendShares(account) || !vault.canReceiveAssets(account)) return 0;
        IERC20 loan = IERC20(vault.asset());
        uint256 liquidity = loan.balanceOf(vaultAddress);
        if (fixedAdapter != address(0)) {
            if (!vault.isAdapter(fixedAdapter)) return 0;
            liquidity += _adapterLiquidity(vault, morpho, fixedAdapter, data, loan);
        }
        return Math.min(vault.convertToAssets(vault.balanceOf(account)), liquidity);
    }

    function _adapterLiquidity(IVaultV2 vault, address morpho, address adapter, bytes memory data, IERC20 loan)
        private
        view
        returns (uint256)
    {
        MarketParams memory params = abi.decode(data, (MarketParams));
        // Vault V2 rejects deallocation when any of its three accounting allocations is zero,
        // even when residual adapter shares have accrued a positive quoted asset value.
        if (
            vault.allocation(keccak256(abi.encode("this", adapter))) == 0
                || vault.allocation(keccak256(abi.encode("collateralToken", params.collateralToken))) == 0
                || vault.allocation(keccak256(abi.encode("this/marketParams", adapter, params))) == 0
        ) return 0;
        bytes32 id = keccak256(data);
        Market memory market = IMorpho(morpho).market(Id.wrap(id));
        uint256 marketLiquidity = uint256(market.totalSupplyAssets) - market.totalBorrowAssets;
        uint256 supplied = IMarketV1AdapterV2(adapter).expectedSupplyAssets(id);
        return Math.min(supplied, Math.min(marketLiquidity, loan.balanceOf(morpho)));
    }
}
