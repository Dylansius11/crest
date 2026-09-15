// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {VaultV2Liquidity} from "../src/libraries/VaultV2Liquidity.sol";
import {MarketParams, Market, Id} from "morpho-blue/src/interfaces/IMorpho.sol";

contract VaultV2LiquidityTest is Test {
    address constant VAULT = address(0x100);
    address constant LOAN = address(0x200);
    address constant MORPHO = address(0x300);
    address constant ADAPTER = address(0x400);
    address constant ACCOUNT = address(0x500);
    MarketParams p;
    bytes data;

    function setUp() public {
        p = MarketParams(LOAN, address(0x600), address(0x700), address(0x800), 0.8e18);
        data = abi.encode(p);
        vm.etch(VAULT, hex"00");
        vm.etch(ADAPTER, hex"00");
        mock(VAULT, abi.encodeWithSignature("asset()"), abi.encode(LOAN));
        mock(VAULT, abi.encodeWithSignature("liquidityAdapter()"), abi.encode(ADAPTER));
        mock(VAULT, abi.encodeWithSignature("liquidityData()"), abi.encode(data));
        mock(VAULT, abi.encodeWithSignature("isAdapter(address)", ADAPTER), abi.encode(true));
        mock(VAULT, abi.encodeWithSignature("balanceOf(address)", ACCOUNT), abi.encode(uint256(1000)));
        mock(VAULT, abi.encodeWithSignature("convertToAssets(uint256)", 1000), abi.encode(uint256(900)));
        mock(VAULT, abi.encodeWithSignature("canSendShares(address)", ACCOUNT), abi.encode(true));
        mock(VAULT, abi.encodeWithSignature("canReceiveAssets(address)", ACCOUNT), abi.encode(true));
        mock(VAULT, abi.encodeWithSignature("maxWithdraw(address)", ACCOUNT), abi.encode(uint256(0)));
        mock(LOAN, abi.encodeWithSignature("balanceOf(address)", VAULT), abi.encode(uint256(10)));
        mock(LOAN, abi.encodeWithSignature("balanceOf(address)", MORPHO), abi.encode(uint256(10000)));
        mock(ADAPTER, abi.encodeWithSignature("parentVault()"), abi.encode(VAULT));
        mock(ADAPTER, abi.encodeWithSignature("asset()"), abi.encode(LOAN));
        mock(ADAPTER, abi.encodeWithSignature("morpho()"), abi.encode(MORPHO));
        mock(ADAPTER, abi.encodeWithSignature("adaptiveCurveIrm()"), abi.encode(p.irm));
        mock(ADAPTER, abi.encodeWithSignature("expectedSupplyAssets(bytes32)", keccak256(data)), abi.encode(uint256(800)));
        mock(MORPHO, abi.encodeWithSignature("market(bytes32)", keccak256(data)), abi.encode(Market(2000, 2e9, 1500, 15e8, 1, 0)));
    }

    function mock(address target, bytes memory input, bytes memory output) internal {
        vm.mockCall(target, input, output);
    }

    function available() external view returns (uint256) {
        return VaultV2Liquidity.available(VAULT, ACCOUNT, MORPHO, ADAPTER, keccak256(data));
    }

    function testZeroMaxDoesNotHideExecutableDefaultLiquidity() public view {
        assertEq(this.available(), 510);
    }

    function testOnlyOwnedAllocationNotMarketTvlCounts() public {
        mock(ADAPTER, abi.encodeWithSignature("expectedSupplyAssets(bytes32)", keccak256(data)), abi.encode(uint256(70)));
        assertEq(this.available(), 80);
    }

    function testTokenBalanceAlsoBoundsLiquidity() public {
        mock(LOAN, abi.encodeWithSignature("balanceOf(address)", MORPHO), abi.encode(uint256(25)));
        assertEq(this.available(), 35);
    }

    function testGateClosedReturnsZero() public {
        mock(VAULT, abi.encodeWithSignature("canReceiveAssets(address)", ACCOUNT), abi.encode(false));
        assertEq(this.available(), 0);
    }

    function testChangedRouteCannotUseNewLiquidity() public {
        mock(VAULT, abi.encodeWithSignature("liquidityAdapter()"), abi.encode(address(0xDEAD)));
        assertEq(this.available(), 0);
    }

    function testChangedDataCannotUseNewLiquidity() public {
        mock(VAULT, abi.encodeWithSignature("liquidityData()"), abi.encode(bytes("changed")));
        assertEq(this.available(), 0);
    }

    function testIdleOnlyVaultDoesNotNeedAdapter() public {
        mock(VAULT, abi.encodeWithSignature("liquidityAdapter()"), abi.encode(address(0)));
        mock(VAULT, abi.encodeWithSignature("liquidityData()"), abi.encode(bytes("")));
        assertEq(VaultV2Liquidity.available(VAULT, ACCOUNT, MORPHO, address(0), keccak256("")), 10);
    }

    function testQuoteBoundsLiquidMarket() public {
        mock(LOAN, abi.encodeWithSignature("balanceOf(address)", VAULT), abi.encode(uint256(1000)));
        assertEq(this.available(), 900);
    }

    function testValidateBindsVaultAdapterAndLoan() public view {
        (address adapter, bytes32 dataHash) = VaultV2Liquidity.validate(VAULT, LOAN, MORPHO);
        assertEq(adapter, ADAPTER);
        assertEq(dataHash, keccak256(data));
    }

    function validate() external view { VaultV2Liquidity.validate(VAULT, LOAN, MORPHO); }

    function testRejectAdapterFromAnotherVault() public {
        mock(ADAPTER, abi.encodeWithSignature("parentVault()"), abi.encode(address(0xDEAD)));
        vm.expectRevert(VaultV2Liquidity.InvalidVaultRoute.selector);
        this.validate();
    }
}
