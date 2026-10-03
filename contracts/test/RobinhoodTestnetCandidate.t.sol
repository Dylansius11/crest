// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {CrestAccount} from "../src/CrestAccount.sol";

/// @notice Fork-only exploration of the independently observed TSLA/USDG candidate on chain 46630.
/// @dev A passing fork is NOT oracle provenance, live lender liquidity, or authorization to sign.
contract RobinhoodTestnetCandidateTest is Test {
    IMorpho internal constant MORPHO = IMorpho(0x2275d8C96E52C3368E062aA04F41578E9bFb99d3);
    IERC20 internal constant USDG = IERC20(0x7E955252E15c84f5768B83c41a71F9eba181802F);
    IERC20 internal constant TSLA = IERC20(0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E);
    IERC4626 internal constant VAULT = IERC4626(0xA630E3995B74C9Dc50Bf05eF6bbBD1D7C67b9D41);
    bytes32 internal constant MARKET_ID = 0xa5b036cccef6ef2079619c6c438aec1a223f451ef17b2304de2dd262c637d80d;
    uint256 internal constant BORROW = 100_000; // 0.1 USDG; only 1 USDG was free in the observed market.
    address internal owner = makeAddr("candidate owner");
    address internal guardian = makeAddr("candidate guardian");

    CrestAccount internal account;
    MarketParams internal params;

    function setUp() public {
        string memory rpc = vm.envOr("CREST_TESTNET_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, 127234001);
        assertEq(block.chainid, 46630, "fork is not Robinhood testnet");
        assertEq(
            vm.parseJsonBytes32(vm.rpcJson("eth_getBlockByNumber", "[\"0x7956fd1\",false]"), ".hash"),
            0xdb19c57b9ed59613ee39cfe11623c5305da8894485df91d959dfd72079d3d544,
            "pinned finalized block hash changed"
        );
        params = MarketParams({
            loanToken: address(USDG),
            collateralToken: address(TSLA),
            oracle: 0xb92da213f9428e19C9e212dBf50A469b959e0a8c,
            irm: 0x438C11352e0e9226d71584B70D86912C389cC42C,
            lltv: 860000000000000000
        });
        assertEq(keccak256(abi.encode(params)), MARKET_ID, "market tuple changed");
        Market memory atEvidence = MORPHO.market(Id.wrap(MARKET_ID));
        assertEq(uint256(atEvidence.totalSupplyAssets) - uint256(atEvidence.totalBorrowAssets), 1_000_000, "sampled market liquidity changed");
        assertEq(VAULT.asset(), address(USDG), "vault underlying changed");
        deal(address(TSLA), owner, 1 ether, true);
        account = new CrestAccount(owner, address(MORPHO));
        vm.prank(owner);
        account.configure(CrestAccount.PolicyConfig({
            market: params,
            yieldVault: address(VAULT),
            maxCollateralAssets: uint128(1 ether),
            debtCeilingAssets: 200_000,
            maxStrategyAssets: 200_000,
            reserveFloorAssets: 0,
            strategyFloorAssets: 0,
            maxRepayPerActionAssets: 50_000,
            lowerLtvWad: 0.05e18,
            targetLtvWad: 0.10e18,
            upperLtvWad: 0.20e18,
            criticalLtvWad: 0.30e18,
            guardian: guardian
        }));
    }

    function testForkCandidateSupplyBorrowStrategyRepayAndOwnerExit() public {
        vm.startPrank(owner);
        TSLA.approve(address(account), 1 ether);
        account.supplyCollateral(1 ether);
        uint256 shares = VAULT.previewDeposit(BORROW);
        account.borrowAndDeploy(BORROW, shares);
        vm.stopPrank();

        Position memory opened = MORPHO.position(Id.wrap(MARKET_ID), address(account));
        assertEq(opened.collateral, 1 ether);
        assertGt(opened.borrowShares, 0);
        assertEq(VAULT.balanceOf(address(account)), shares);
        uint256 debtBefore = account.currentDebtAssets();
        uint256 withdrawable = account.maxWithdrawableStrategyAssets();
        assertGe(withdrawable, 50_000, "strategy cannot redeem one bounded repayment");

        vm.prank(guardian);
        account.freezeBorrowing();
        vm.prank(guardian);
        account.repayFromStrategy(50_000);
        assertLt(account.currentDebtAssets(), debtBefore, "Guardian must reduce canonical debt");
        assertEq(USDG.balanceOf(address(account)), 0, "no redirected repayment proceeds");

        vm.startPrank(owner);
        account.withdrawStrategy(account.strategyAssets(), owner, type(uint256).max);
        uint256 remaining = account.currentDebtAssets();
        deal(address(USDG), owner, remaining, true);
        USDG.approve(address(account), remaining);
        account.ownerRepay(type(uint256).max);
        account.withdrawCollateral(1 ether, owner);
        vm.stopPrank();

        assertEq(MORPHO.position(Id.wrap(MARKET_ID), address(account)).borrowShares, 0);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(TSLA.balanceOf(owner), 1 ether);
    }
}
