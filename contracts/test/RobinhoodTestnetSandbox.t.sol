// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {CrestAccount} from "../src/CrestAccount.sol";

/// @notice Fork proof of the 46630 SANDBOX route recorded in config/deployment-manifest.46630.json.
/// @dev Sandbox trust: unofficial faucet TSLA, a publicly settable MockFeed price, a fixed MockIRM, and an
/// idle-only Vault V2. A passing fork proves contract compatibility only, never oracle trust or yield.
contract RobinhoodTestnetSandboxTest is Test {
    IMorpho internal constant MORPHO = IMorpho(0x99607363652591ffF66BA23EF8D91563CA48038b);
    IERC20 internal constant USDG = IERC20(0x7E955252E15c84f5768B83c41a71F9eba181802F);
    IERC20 internal constant TSLA = IERC20(0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E);
    IERC4626 internal constant VAULT = IERC4626(0x70F514670d554f3388e15eBce2c7Aa37307A21Bc);
    bytes32 internal constant MARKET_ID = 0x165f9db8f5e1d9982a35dfaadb3f944cf747970c8f819f16f10105f5c7eb6e04;
    uint256 internal constant BLOCK = 127414784;
    uint256 internal constant COLLATERAL = 1 ether;
    uint256 internal constant BORROW = 10_000_000; // 10 USDG of the 110.239151 USDG free at BLOCK.
    uint256 internal constant GUARDIAN_REPAY = 5_000_000;
    address internal owner = makeAddr("sandbox owner");
    address internal guardian = makeAddr("sandbox guardian");

    CrestAccount internal account;
    MarketParams internal params;

    function setUp() public {
        string memory rpc = vm.envOr("CREST_TESTNET_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc, BLOCK);
        assertEq(block.chainid, 46630, "fork is not Robinhood testnet");
        assertEq(
            vm.parseJsonBytes32(vm.rpcJson("eth_getBlockByNumber", "[\"0x7983200\",false]"), ".hash"),
            0x6ce23e0d7d93e26936e953d198dad051d01d6eabe01c9e61006147493b24a5e8,
            "pinned finalized block hash changed"
        );
        params = MarketParams({
            loanToken: address(USDG),
            collateralToken: address(TSLA),
            oracle: 0x79DA01DB22808E3A7397B788F171a7647b1bEf8f,
            irm: 0xc15Db6c9c5B7bAd92C088E0918D5C720A5c44630,
            lltv: 860000000000000000
        });
        assertEq(keccak256(abi.encode(params)), MARKET_ID, "market tuple changed");
        Market memory atEvidence = MORPHO.market(Id.wrap(MARKET_ID));
        assertEq(
            uint256(atEvidence.totalSupplyAssets) - uint256(atEvidence.totalBorrowAssets),
            110_239_151,
            "sampled market liquidity changed"
        );
        assertEq(VAULT.asset(), address(USDG), "vault underlying changed");
        assertEq(USDG.balanceOf(address(VAULT)), 63_000_000, "sampled idle vault liquidity changed");
        deal(address(TSLA), owner, COLLATERAL, true);
        account = new CrestAccount(owner, address(MORPHO));
        vm.prank(owner);
        account.configure(
            CrestAccount.PolicyConfig({
                market: params,
                yieldVault: address(VAULT),
                maxCollateralAssets: uint128(COLLATERAL),
                debtCeilingAssets: 20_000_000,
                maxStrategyAssets: 20_000_000,
                reserveFloorAssets: 0,
                strategyFloorAssets: 0,
                maxRepayPerActionAssets: uint128(GUARDIAN_REPAY),
                lowerLtvWad: 0.02e18,
                targetLtvWad: 0.05e18,
                upperLtvWad: 0.1e18,
                criticalLtvWad: 0.2e18,
                guardian: guardian
            })
        );
    }

    function testSandboxRouteBindsIdleOnlyVault() public view {
        assertEq(account.vaultLiquidityAdapter(), address(0), "sandbox vault must stay idle-only");
        assertEq(account.marketId(), MARKET_ID);
    }

    function testSandboxSupplyBorrowGuardianRepayAndOwnerExit() public {
        vm.startPrank(owner);
        TSLA.approve(address(account), COLLATERAL);
        account.supplyCollateral(COLLATERAL);
        uint256 shares = VAULT.previewDeposit(BORROW);
        account.borrowAndDeploy(BORROW, shares);
        vm.stopPrank();

        Position memory opened = MORPHO.position(Id.wrap(MARKET_ID), address(account));
        assertEq(opened.collateral, COLLATERAL);
        assertGt(opened.borrowShares, 0);
        assertEq(VAULT.balanceOf(address(account)), shares);
        assertGe(account.maxWithdrawableStrategyAssets(), GUARDIAN_REPAY, "idle vault cannot fund one repayment");

        vm.prank(guardian);
        vm.expectRevert();
        account.borrowAndDeploy(1, 0);

        uint256 debtBefore = account.currentDebtAssets();
        vm.startPrank(guardian);
        account.freezeBorrowing();
        account.repayFromStrategy(type(uint256).max);
        vm.stopPrank();
        uint256 debtAfter = account.currentDebtAssets();
        assertLt(debtAfter, debtBefore, "Guardian must reduce canonical debt");
        assertLe(debtBefore - debtAfter, GUARDIAN_REPAY, "Guardian repayment exceeded its per-action cap");
        assertEq(USDG.balanceOf(address(account)), 0, "no redirected repayment proceeds");

        vm.prank(owner);
        vm.expectRevert(CrestAccount.BorrowingIsFrozen.selector);
        account.borrowAndDeploy(1, 0);

        vm.startPrank(owner);
        uint256 strategyAssets = account.strategyAssets();
        uint256 sharesBeforeExit = VAULT.balanceOf(address(account));
        account.withdrawStrategy(strategyAssets, owner, type(uint256).max);
        uint256 remaining = account.currentDebtAssets();
        if (USDG.balanceOf(owner) < remaining) deal(address(USDG), owner, remaining, true);
        USDG.approve(address(account), remaining);
        account.ownerRepay(type(uint256).max);
        account.withdrawCollateral(COLLATERAL, owner);
        vm.stopPrank();

        // Manifest forkProof evidence; values are read from the fork, never typed in.
        console2.log("mintedShares", shares);
        console2.log("guardianRepaidAssets", debtBefore - debtAfter);
        console2.log("ownerWithdrawnStrategyAssets", strategyAssets);
        console2.log("ownerWithdrawnShares", sharesBeforeExit - VAULT.balanceOf(address(account)));
        console2.log("finalShares", VAULT.balanceOf(address(account)));
        console2.log("ownerRepaidAssets", remaining);

        assertEq(MORPHO.position(Id.wrap(MARKET_ID), address(account)).borrowShares, 0);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(TSLA.balanceOf(owner), COLLATERAL);
    }
}
