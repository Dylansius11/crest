// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CrestAccount} from "../src/CrestAccount.sol";
import {MockMorpho} from "./mocks/MockMorpho.sol";
import {MockVault} from "./mocks/MockVault.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {MockIrm} from "./mocks/MockIrm.sol";
import {MarketParams, Id} from "morpho-blue/src/interfaces/IMorpho.sol";

abstract contract CrestFixture is Test {
    CrestAccount internal account;
    MockMorpho internal morpho;
    MockVault internal vault;
    MockToken internal loan;
    MockToken internal collateral;
    MockIrm internal irm;
    address internal owner = address(0xA11CE);
    address internal guardian = address(0xB0B);
    address internal stranger = address(0xBAD);
    MarketParams internal market;

    function setUp() public virtual {
        vm.warp(1_000);
        loan = new MockToken("Loan", "LOAN");
        collateral = new MockToken("Collateral", "COLL");
        irm = new MockIrm();
        morpho = new MockMorpho();
        vault = new MockVault(address(loan));
        market = MarketParams(address(loan), address(collateral), address(irm), address(irm), 0.8e18);
        morpho.configureMarket(market);
        morpho.seedLiquidity(1_000_000e6);
        account = new CrestAccount(owner, address(morpho));
        vm.prank(owner);
        account.configure(config());
        collateral.mint(owner, 1_000e18);
        loan.mint(owner, 1_000_000e6);
        vm.startPrank(owner);
        collateral.approve(address(account), type(uint256).max);
        loan.approve(address(account), type(uint256).max);
        vm.stopPrank();
    }

    function config() internal view returns (CrestAccount.PolicyConfig memory c) {
        c = CrestAccount.PolicyConfig({
            market: market,
            yieldVault: address(vault),
            maxCollateralAssets: 100e18,
            debtCeilingAssets: 1_000e6,
            maxStrategyAssets: 2_000e6,
            reserveFloorAssets: 10e6,
            strategyFloorAssets: 20e6,
            maxRepayPerActionAssets: 100e6,
            lowerLtvWad: 0.2e18,
            targetLtvWad: 0.3e18,
            upperLtvWad: 0.4e18,
            criticalLtvWad: 0.5e18,
            guardian: guardian
        });
    }

    function open(uint256 debt) internal {
        vm.startPrank(owner);
        account.supplyCollateral(10e18);
        account.borrowAndDeploy(debt, debt);
        vm.stopPrank();
    }

    function assertCleanApprovals() internal view {
        assertEq(loan.allowance(address(account), address(morpho)), 0);
        assertEq(loan.allowance(address(account), address(vault)), 0);
        assertEq(collateral.allowance(address(account), address(morpho)), 0);
    }
}

contract CrestAccountTest is CrestFixture {
    function testConfigurationExposesExactPolicy() public view {
        CrestAccount.PolicyConfig memory c = account.policy();
        assertEq(keccak256(abi.encode(c)), keccak256(abi.encode(config())));
        assertEq(account.marketId(), keccak256(abi.encode(market)));
        assertEq(address(account.morpho()), address(morpho));
        assertEq(account.policyNonce(), 1);
    }

    function testGuardianAndStrangerCannotReachAnyOwnerMutation() public {
        bytes[] memory calls = new bytes[](13);
        calls[0] = abi.encodeCall(account.configure, (config()));
        calls[1] = abi.encodeCall(account.setGuardian, (stranger));
        calls[2] = abi.encodeCall(account.unfreezeBorrowing, ());
        calls[3] = abi.encodeCall(account.supplyCollateral, (1));
        calls[4] = abi.encodeCall(account.borrowAndDeploy, (1, 0));
        calls[5] = abi.encodeCall(account.depositToStrategy, (1, 0));
        calls[6] = abi.encodeCall(account.ownerRepay, (1));
        calls[7] = abi.encodeCall(account.withdrawCollateral, (1, stranger));
        calls[8] = abi.encodeCall(account.withdrawLoanToken, (1, stranger));
        calls[9] = abi.encodeCall(account.withdrawStrategy, (1, stranger, 1));
        calls[10] = abi.encodeCall(account.transferOwnership, (stranger));
        calls[11] = abi.encodeCall(account.renounceOwnership, ());
        calls[12] = abi.encodeCall(account.acceptOwnership, ());
        for (uint256 role; role < 2; ++role) {
            address actor = role == 0 ? guardian : stranger;
            for (uint256 i; i < calls.length; ++i) {
                vm.prank(actor);
                (bool ok, bytes memory result) = address(account).call(calls[i]);
                assertFalse(ok, "unauthorized owner mutation");
                bytes4 expected = i == 12 && actor == guardian
                    ? CrestAccount.InvalidConfiguration.selector
                    : Ownable.OwnableUnauthorizedAccount.selector;
                assertEq(bytes4(result), expected, "must reject authority, not insufficient funds");
            }
        }
        assertEq(account.owner(), owner);
        assertEq(account.guardian(), guardian);
    }

    function testStrangerCannotUseGuardianActionsOrUnknownSelector() public {
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(account.freezeBorrowing, ());
        calls[1] = abi.encodeCall(account.repayFromReserve, (1));
        calls[2] = abi.encodeCall(account.repayFromStrategy, (1));
        calls[3] = hex"deadbeef";
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(stranger);
            (bool ok, bytes memory result) = address(account).call(calls[i]);
            assertFalse(ok);
            if (i < 3) assertEq(bytes4(result), CrestAccount.Unauthorized.selector);
        }
    }

    function testFreezeDoesNotPreventRepaymentOrOwnerExit() public {
        open(200e6);
        vm.prank(guardian);
        account.freezeBorrowing();
        vm.prank(owner);
        vm.expectRevert(CrestAccount.BorrowingIsFrozen.selector);
        account.borrowAndDeploy(1, 0);
        vm.prank(guardian);
        account.repayFromStrategy(100e6);
        vm.startPrank(owner);
        account.ownerRepay(type(uint256).max);
        account.withdrawCollateral(10e18, owner);
        account.withdrawStrategy(80e6, owner, type(uint256).max);
        account.unfreezeBorrowing();
        vm.stopPrank();
        assertFalse(account.borrowingFrozen());
        assertEq(account.currentDebtAssets(), 0);
        assertCleanApprovals();
    }

    function testTwoStepOwnershipRevocationAndRoleSeparation() public {
        vm.prank(owner);
        account.transferOwnership(stranger);
        assertEq(account.owner(), owner);
        vm.prank(stranger);
        account.acceptOwnership();
        assertEq(account.owner(), stranger);
        vm.prank(owner);
        vm.expectRevert();
        account.setGuardian(address(0));
        vm.prank(stranger);
        account.setGuardian(address(0));
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.Unauthorized.selector);
        account.freezeBorrowing();
        vm.prank(stranger);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.setGuardian(stranger);
        vm.prank(stranger);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.renounceOwnership();
    }

    function testPendingOwnerCannotBecomeGuardianThenAcceptOwnership() public {
        vm.startPrank(owner);
        account.transferOwnership(stranger);
        account.setGuardian(stranger);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.acceptOwnership();
    }

    function testInvalidPolicyOrderingAndZeroRepayCapRejected() public {
        CrestAccount.PolicyConfig memory c = config();
        c.targetLtvWad = c.lowerLtvWad;
        vm.prank(owner);
        vm.expectRevert(CrestAccount.LtvPolicyInvalid.selector);
        account.configure(c);
        c = config();
        c.criticalLtvWad = uint64(c.market.lltv);
        vm.prank(owner);
        vm.expectRevert(CrestAccount.LtvPolicyInvalid.selector);
        account.configure(c);
        c = config();
        c.maxRepayPerActionAssets = 0;
        vm.prank(owner);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.configure(c);
        c = config();
        c.strategyFloorAssets = c.maxStrategyAssets + 1;
        vm.prank(owner);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.configure(c);
    }

    function testWrongVaultAssetAndUncreatedMarketRejected() public {
        CrestAccount.PolicyConfig memory c = config();
        c.yieldVault = address(new MockVault(address(collateral)));
        vm.prank(owner);
        vm.expectRevert();
        account.configure(c);
        c = config();
        c.market.lltv = 0.7e18;
        vm.prank(owner);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.configure(c);
    }

    function testEachActiveBalanceLocksRouteIdentity() public {
        CrestAccount.PolicyConfig memory c = config();
        c.yieldVault = address(new MockVault(address(loan)));
        loan.mint(address(account), 1);
        vm.prank(owner);
        vm.expectRevert(CrestAccount.ActivePositionOrBalance.selector);
        account.configure(c);
        loan.burn(address(account), 1);
        vm.prank(owner);
        account.depositToStrategy(1, 1);
        vm.prank(owner);
        vm.expectRevert(CrestAccount.ActivePositionOrBalance.selector);
        account.configure(c);
        vm.prank(owner);
        account.withdrawStrategy(1, owner, 1);
        assertEq(vault.balanceOf(address(account)), 0);
        vm.prank(owner);
        account.supplyCollateral(1);
        vm.prank(owner);
        vm.expectRevert(CrestAccount.ActivePositionOrBalance.selector);
        account.configure(c);
        vm.prank(owner);
        account.withdrawCollateral(1, owner);
        morpho.setPosition(address(account), 0, 1, 0);
        vm.prank(owner);
        vm.expectRevert(CrestAccount.ActivePositionOrBalance.selector);
        account.configure(c);
        morpho.setPosition(address(account), 0, 0, 0);
        vm.prank(owner);
        account.configure(c);
        assertEq(account.yieldVault(), c.yieldVault);
    }

    function testActivePolicyCannotLowerCapsBelowExposure() public {
        open(200e6);
        CrestAccount.PolicyConfig memory c = config();
        c.debtCeilingAssets = 199e6;
        vm.prank(owner);
        vm.expectRevert();
        account.configure(c);
        c = config();
        c.maxCollateralAssets = 9e18;
        vm.prank(owner);
        vm.expectRevert();
        account.configure(c);
        c = config();
        c.maxStrategyAssets = 199e6;
        vm.prank(owner);
        vm.expectRevert();
        account.configure(c);
    }

    function testBorrowDepositsExactAssetsWithoutTouchingReserve() public {
        loan.mint(address(account), 17e6);
        open(200e6);
        assertEq(account.currentDebtAssets(), 200e6);
        assertEq(vault.balanceOf(address(account)), 200e6);
        assertEq(account.idleReserveAssets(), 17e6);
        assertEq(loan.balanceOf(guardian), 0);
        assertEq(vault.balanceOf(guardian), 0);
        assertCleanApprovals();
    }

    function testCollateralAndDebtCapsRejectBoundaryPlusOne() public {
        vm.prank(owner);
        vm.expectRevert();
        account.supplyCollateral(100e18 + 1);
        open(1_000e6);
        vm.prank(owner);
        vm.expectRevert();
        account.borrowAndDeploy(1, 0);
        assertEq(account.currentDebtAssets(), 1_000e6);
    }

    function testAccruedRoundedUpDebtControlsCeiling() public {
        open(999e6);
        irm.setBorrowRatePerSecondWad(1e12);
        vm.warp(block.timestamp + 2_000);
        assertGt(account.currentDebtAssets(), 1_000e6);
        vm.prank(owner);
        vm.expectRevert();
        account.borrowAndDeploy(1, 0);
    }

    function testVaultFailureOrShareSlippageRollsBackBorrow() public {
        vault.setDepositShareBps(9_999);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(CrestAccount.InsufficientVaultShares.selector, 100e6, 99_990_000));
        account.borrowAndDeploy(100e6, 100e6);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(vault.balanceOf(address(account)), 0);
        vault.setGates(true, true, false);
        vm.prank(owner);
        vm.expectRevert();
        account.borrowAndDeploy(100e6, 0);
        assertEq(account.currentDebtAssets(), 0);
        assertCleanApprovals();
    }

    function testStrategyCapIncludesOwnerDepositsAndVaultYield() public {
        vm.prank(owner);
        account.depositToStrategy(1_900e6, 1_900e6);
        vm.prank(owner);
        loan.approve(address(vault), 100e6);
        vm.prank(owner);
        vault.donate(100e6);
        vm.prank(owner);
        vm.expectRevert();
        account.borrowAndDeploy(2, 0);
        vm.prank(owner);
        vm.expectRevert();
        account.depositToStrategy(2, 0);
        assertEq(account.currentDebtAssets(), 0);
    }

    function testReserveRepayClampsToFloorCapAndOwnDebt() public {
        open(200e6);
        loan.mint(address(account), 250e6);
        vm.prank(guardian);
        account.repayFromReserve(type(uint256).max);
        assertEq(account.currentDebtAssets(), 100e6);
        assertEq(account.idleReserveAssets(), 150e6);
        vm.prank(guardian);
        account.repayFromReserve(type(uint256).max);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(account.idleReserveAssets(), 50e6);
        assertEq(loan.balanceOf(guardian), 0);
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.RepayAmountZero.selector);
        account.repayFromReserve(1);
        assertCleanApprovals();
    }

    function testReserveFloorAndZeroRequestsCannotRepay() public {
        open(200e6);
        loan.mint(address(account), 11e6);
        vm.prank(guardian);
        account.repayFromReserve(100e6);
        assertEq(account.idleReserveAssets(), 10e6);
        assertEq(account.currentDebtAssets(), 199e6);
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.RepayAmountZero.selector);
        account.repayFromReserve(100e6);
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.RepayAmountZero.selector);
        account.repayFromStrategy(0);
    }

    function testStrategyRepayPreservesFloorAndReserve() public {
        open(200e6);
        loan.mint(address(account), 11e6);
        vm.prank(guardian);
        account.repayFromStrategy(type(uint256).max);
        vm.prank(guardian);
        account.repayFromStrategy(type(uint256).max);
        assertEq(account.strategyAssets(), 20e6);
        assertEq(account.currentDebtAssets(), 20e6);
        assertEq(account.idleReserveAssets(), 11e6);
        assertEq(loan.balanceOf(guardian), 0);
        assertEq(vault.balanceOf(guardian), 0);
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.RepayAmountZero.selector);
        account.repayFromStrategy(1);
        assertCleanApprovals();
    }

    function testVaultLossAndPhysicalLiquidityTightenRepayment() public {
        open(200e6);
        vault.realizeLoss(100e6);
        loan.burn(address(vault), 70e6);
        assertEq(account.maxWithdrawableStrategyAssets(), 30e6);
        vm.prank(guardian);
        account.repayFromStrategy(100e6);
        assertEq(account.currentDebtAssets(), 170e6);
        assertEq(loan.balanceOf(address(vault)), 0);
    }

    function testWithdrawalGateFailureRollsBackRepayment() public {
        open(200e6);
        vault.setWithdrawalLimit(1);
        vm.prank(guardian);
        vm.expectRevert();
        account.repayFromStrategy(100e6);
        assertEq(account.currentDebtAssets(), 200e6);
        assertEq(account.strategyAssets(), 200e6);
        vault.setGates(false, true, true);
        assertEq(account.maxWithdrawableStrategyAssets(), 0);
    }

    function testOwnerWithdrawalFloorAndShareSlippage() public {
        open(200e6);
        loan.mint(address(account), 11e6);
        vm.startPrank(owner);
        vm.expectRevert();
        account.withdrawLoanToken(1e6 + 1, owner);
        account.withdrawLoanToken(1e6, owner);
        vm.expectRevert();
        account.withdrawStrategy(100e6, owner, 100e6 - 1);
        account.withdrawStrategy(100e6, stranger, 100e6);
        vm.stopPrank();
        assertEq(loan.balanceOf(stranger), 100e6);
        assertEq(account.idleReserveAssets(), 10e6);
    }

    function testOwnerFullRepayClearsRoundedUpShares() public {
        open(200e6);
        irm.setBorrowRatePerSecondWad(1e12);
        vm.warp(block.timestamp + 100);
        uint256 debt = account.currentDebtAssets();
        uint256 before = loan.balanceOf(owner);
        vm.prank(owner);
        account.ownerRepay(type(uint256).max);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(before - loan.balanceOf(owner), debt);
        assertCleanApprovals();
    }

    function testTokenCallbackCannotReenterEvenAsGuardian() public {
        open(200e6);
        loan.mint(address(account), 200e6);
        vm.prank(owner);
        account.setGuardian(address(loan));
        loan.setCallback(address(account), abi.encodeCall(account.repayFromReserve, (1)), true);
        vm.prank(address(loan));
        vm.expectRevert(bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        account.repayFromStrategy(100e6);
        assertEq(account.currentDebtAssets(), 200e6);
        assertEq(account.strategyAssets(), 200e6);
        assertCleanApprovals();
    }

    function testFuzzReserveRepaymentBounds(uint96 reserve, uint96 requested) public {
        open(200e6);
        uint256 idle = bound(reserve, 10e6, 500e6);
        uint256 request = bound(requested, 1, 500e6);
        loan.mint(address(account), idle);
        uint256 expected = min(min(request, 100e6), idle - 10e6);
        vm.prank(guardian);
        if (expected == 0) vm.expectRevert(CrestAccount.RepayAmountZero.selector);
        account.repayFromReserve(request);
        assertEq(account.currentDebtAssets(), 200e6 - expected);
        assertEq(account.idleReserveAssets(), idle - expected);
        assertEq(loan.balanceOf(guardian), 0);
    }

    function testRouteDriftStopsNewDeploymentUntilOwnerReconfigures() public {
        vault.setLiquidityAdapter(address(0), hex"01");
        vm.prank(owner);
        vm.expectRevert();
        account.borrowAndDeploy(100e6, 0);
        vm.prank(owner);
        vm.expectRevert();
        account.depositToStrategy(100e6, 0);
        assertEq(account.currentDebtAssets(), 0);
        vm.prank(owner);
        account.configure(config());
        vm.prank(owner);
        account.borrowAndDeploy(100e6, 100e6);
        assertEq(account.currentDebtAssets(), 100e6);
    }

    function testRepaymentThatBurnsNoDebtSharesRevertsAtomically() public {
        // A one-unit repayment rounds down to zero shares in this accrued market.
        morpho.setMarketState(1_000e6, 1_000e12, 100e6, 1);
        morpho.setPosition(address(account), 0, 1, 1);
        loan.mint(address(account), 20e6);
        uint256 beforeDebt = account.currentDebtAssets();
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.PostconditionFailed.selector);
        account.repayFromReserve(1);
        assertEq(account.currentDebtAssets(), beforeDebt);
        assertEq(account.idleReserveAssets(), 20e6);
        assertCleanApprovals();
    }

    function testGuardianFullRepaymentClearsAccruedRoundingDust() public {
        open(50e6);
        irm.setBorrowRatePerSecondWad(1e12);
        vm.warp(block.timestamp + 100);
        loan.mint(address(account), 100e6);
        uint256 debt = account.currentDebtAssets();
        vm.prank(guardian);
        account.repayFromReserve(type(uint256).max);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(account.idleReserveAssets(), 100e6 - debt);
    }

    function testOwnerCanExitStrategyBelowRoutineGuardianFloor() public {
        open(200e6);
        vm.startPrank(owner);
        account.ownerRepay(type(uint256).max);
        account.withdrawStrategy(200e6, owner, 200e6);
        account.withdrawCollateral(10e18, owner);
        vm.stopPrank();
        assertEq(account.strategyAssets(), 0);
        CrestAccount.PolicyConfig memory c = config();
        c.yieldVault = address(new MockVault(address(loan)));
        vm.prank(owner);
        account.configure(c);
        assertEq(account.yieldVault(), c.yieldVault);
    }

    function testPolicyAndDebtEventsReconcileCanonicalState() public {
        CrestAccount.PolicyConfig memory c = config();
        c.debtCeilingAssets = 900e6;
        vm.expectEmit(true, true, true, true, address(account));
        emit CrestAccount.PolicyConfigured(2, account.marketId(), address(vault), keccak256(abi.encode(c)));
        vm.prank(owner);
        account.configure(c);
        vm.expectEmit(false, false, false, true, address(account));
        emit CrestAccount.BorrowedAndDeployed(200e6, 200e6, 200e6, 200e6);
        vm.prank(owner);
        account.borrowAndDeploy(200e6, 200e6);
        vm.expectEmit(true, false, false, true, address(account));
        emit CrestAccount.RepaidFromStrategy(guardian, 500e6, 100e6, 100e6, 200e6, 100e6, 200e6, 100e6);
        vm.prank(guardian);
        account.repayFromStrategy(500e6);
        loan.mint(address(account), 200e6);
        vm.expectEmit(true, false, false, true, address(account));
        emit CrestAccount.RepaidFromReserve(guardian, 500e6, 100e6, 100e6, 0);
        vm.prank(guardian);
        account.repayFromReserve(500e6);
        assertEq(account.currentDebtAssets(), 0);
    }

    function testShareSlippageReportsRequestedAndActualShares() public {
        vault.setDepositShareBps(9_000);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("InsufficientVaultShares(uint256,uint256)", 100e6, 90e6));
        account.depositToStrategy(100e6, 100e6);
    }

    function testStrategyRepaymentRecordsAssetLossSeparatelyFromDebtReduction() public {
        open(200e6);
        vault.realizeLoss(50e6);
        uint256 beforeAssets = account.strategyAssets();
        uint256 expectedShares = vault.previewWithdraw(100e6);
        vm.recordLogs();
        vm.prank(guardian);
        account.repayFromStrategy(100e6);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 signature =
            keccak256("RepaidFromStrategy(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");
        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].emitter == address(account) && entries[i].topics[0] == signature) {
                found = true;
                assertEq(entries[i].topics[1], bytes32(uint256(uint160(guardian))));
                assertEq(
                    entries[i].data,
                    abi.encode(
                        uint256(100e6),
                        uint256(100e6),
                        expectedShares,
                        uint256(200e6),
                        uint256(100e6),
                        beforeAssets,
                        account.strategyAssets()
                    )
                );
            }
        }
        assertTrue(found, "missing strategy and canonical debt evidence");
    }

    function testUnsolicitedMorphoSupplyCannotPermanentlyLockEmptyRoute() public {
        // Morpho permits anyone to supply loan tokens on behalf of any address.
        morpho.setPosition(address(account), 1, 0, 0);
        CrestAccount.PolicyConfig memory c = config();
        c.yieldVault = address(new MockVault(address(loan)));
        vm.prank(owner);
        account.configure(c);
        assertEq(account.yieldVault(), c.yieldVault);
    }

    function testRepeatedPartialRepaymentAfterAccrualUsesAssetModeSafely() public {
        open(200e6);
        irm.setBorrowRatePerSecondWad(1e12);
        vm.warp(block.timestamp + 100);
        loan.mint(address(account), 300e6);
        uint256 debtBefore = account.currentDebtAssets();
        vm.prank(guardian);
        account.repayFromReserve(50e6);
        uint256 debtAfter = account.currentDebtAssets();
        assertGt(debtBefore - debtAfter, 0);
        assertLe(debtBefore - debtAfter, 50e6);
        vm.prank(guardian);
        account.repayFromStrategy(50e6);
        assertGt(debtAfter - account.currentDebtAssets(), 0);
        assertLe(debtAfter - account.currentDebtAssets(), 50e6);
        assertEq(account.idleReserveAssets(), 250e6);
        assertEq(loan.balanceOf(guardian), 0);
        assertCleanApprovals();
    }

    function testGuardianStrategyRepayCanClearDebtWithSurplusStrategy() public {
        open(50e6);
        vm.prank(owner);
        account.depositToStrategy(50e6, 50e6);
        irm.setBorrowRatePerSecondWad(1e12);
        vm.warp(block.timestamp + 100);
        uint256 debt = account.currentDebtAssets();
        vm.prank(guardian);
        account.repayFromStrategy(type(uint256).max);
        assertEq(account.currentDebtAssets(), 0);
        assertEq(account.strategyAssets(), 100e6 - debt);
        assertEq(account.idleReserveAssets(), 0);
        assertEq(loan.balanceOf(guardian), 0);
        assertCleanApprovals();
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
