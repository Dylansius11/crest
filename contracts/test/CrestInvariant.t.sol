// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {CrestFixture} from "./CrestAccount.t.sol";
import {CrestAccount} from "../src/CrestAccount.sol";
import {MockMorpho} from "./mocks/MockMorpho.sol";
import {MockVault} from "./mocks/MockVault.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {MockIrm} from "./mocks/MockIrm.sol";
import {Id} from "morpho-blue/src/interfaces/IMorpho.sol";

contract CrestAccountHandler is Test {
    CrestAccount internal immutable account;
    MockMorpho internal immutable morpho;
    MockVault internal immutable vault;
    MockToken internal immutable loan;
    MockIrm internal immutable irm;
    address internal immutable owner;
    address internal immutable guardian;
    address internal immutable stranger;

    uint256 public forbiddenOwnerCallSucceeded;
    uint256 public forbiddenGuardianCallSucceeded;
    uint256 public revokedGuardianCallSucceeded;
    uint256 public frozenBorrowSucceeded;

    uint256 public successfulSupply;
    uint256 public lastSupplyCollateral;
    uint256 public lastSupplyCap;

    uint256 public successfulBorrow;
    uint256 public lastBorrowedAssets;
    uint256 public lastBorrowDebtAfter;
    uint256 public lastBorrowDebtCap;
    uint256 public lastBorrowStrategyAfter;
    uint256 public lastBorrowStrategyCap;
    uint256 public lastBorrowReserveBefore;
    uint256 public lastBorrowReserveAfter;
    uint256 public lastBorrowVaultLoanBefore;
    uint256 public lastBorrowVaultLoanAfter;
    uint256 public lastBorrowGuardianLoanBefore;
    uint256 public lastBorrowGuardianLoanAfter;

    uint256 public successfulDeposit;
    uint256 public lastDepositStrategyAfter;
    uint256 public lastDepositStrategyCap;

    uint256 public successfulReserveRepay;
    uint256 public lastReserveDebtBefore;
    uint256 public lastReserveDebtAfter;
    uint256 public lastReserveAfter;
    uint256 public lastReserveFloor;
    uint256 public lastReserveCap;
    uint256 public lastReserveGuardianLoanBefore;
    uint256 public lastReserveGuardianLoanAfter;
    uint256 public lastReserveGuardianSharesBefore;
    uint256 public lastReserveGuardianSharesAfter;

    uint256 public successfulStrategyRepay;
    uint256 public lastStrategyDebtBefore;
    uint256 public lastStrategyDebtAfter;
    uint256 public lastStrategyAfter;
    uint256 public lastStrategyFloor;
    uint256 public lastStrategyCap;
    uint256 public lastStrategyReserveBefore;
    uint256 public lastStrategyReserveAfter;
    uint256 public lastStrategyGuardianLoanBefore;
    uint256 public lastStrategyGuardianLoanAfter;
    uint256 public lastStrategyGuardianSharesBefore;
    uint256 public lastStrategyGuardianSharesAfter;

    constructor(
        CrestAccount account_,
        MockMorpho morpho_,
        MockVault vault_,
        MockToken loan_,
        MockIrm irm_,
        address owner_,
        address guardian_,
        address stranger_
    ) {
        account = account_;
        morpho = morpho_;
        vault = vault_;
        loan = loan_;
        irm = irm_;
        owner = owner_;
        guardian = guardian_;
        stranger = stranger_;
    }

    function ownerSupplyCollateral(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 current = morpho.position(Id.wrap(account.marketId()), address(account)).collateral;
        if (current >= c.maxCollateralAssets) return;
        uint256 amount = bound(uint256(seed), 1, _min(c.maxCollateralAssets - current, 10e18));
        if (_callAs(owner, abi.encodeCall(account.supplyCollateral, (amount)))) {
            ++successfulSupply;
            lastSupplyCollateral = morpho.position(Id.wrap(account.marketId()), address(account)).collateral;
            lastSupplyCap = c.maxCollateralAssets;
        }
    }

    function ownerBorrowAndDeploy(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 debt = account.currentDebtAssets();
        uint256 strategy = account.strategyAssets();
        if (account.borrowingFrozen()) {
            if (_callAs(owner, abi.encodeCall(account.borrowAndDeploy, (1, 0)))) ++frozenBorrowSucceeded;
            return;
        }
        if (debt >= c.debtCeilingAssets || strategy >= c.maxStrategyAssets) return;
        uint256 maximum = _min(c.debtCeilingAssets - debt, c.maxStrategyAssets - strategy);
        if (maximum == 0) return;
        uint256 amount = bound(uint256(seed), 1, _min(maximum, 100e6));
        uint256 reserveBefore = account.idleReserveAssets();
        uint256 vaultLoanBefore = loan.balanceOf(address(vault));
        uint256 guardianLoanBefore = loan.balanceOf(guardian);
        if (_callAs(owner, abi.encodeCall(account.borrowAndDeploy, (amount, 0)))) {
            ++successfulBorrow;
            lastBorrowedAssets = amount;
            lastBorrowDebtAfter = account.currentDebtAssets();
            lastBorrowDebtCap = c.debtCeilingAssets;
            lastBorrowStrategyAfter = account.strategyAssets();
            lastBorrowStrategyCap = c.maxStrategyAssets;
            lastBorrowReserveBefore = reserveBefore;
            lastBorrowReserveAfter = account.idleReserveAssets();
            lastBorrowVaultLoanBefore = vaultLoanBefore;
            lastBorrowVaultLoanAfter = loan.balanceOf(address(vault));
            lastBorrowGuardianLoanBefore = guardianLoanBefore;
            lastBorrowGuardianLoanAfter = loan.balanceOf(guardian);
        }
    }

    function ownerDepositToStrategy(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 strategy = account.strategyAssets();
        uint256 ownerBalance = loan.balanceOf(owner);
        if (strategy >= c.maxStrategyAssets || ownerBalance == 0) return;
        uint256 maximum = _min(c.maxStrategyAssets - strategy, ownerBalance);
        uint256 amount = bound(uint256(seed), 1, _min(maximum, 100e6));
        if (_callAs(owner, abi.encodeCall(account.depositToStrategy, (amount, 0)))) {
            ++successfulDeposit;
            lastDepositStrategyAfter = account.strategyAssets();
            lastDepositStrategyCap = c.maxStrategyAssets;
        }
    }

    function ownerRepay(uint96 seed) external {
        uint256 debt = account.currentDebtAssets();
        uint256 ownerBalance = loan.balanceOf(owner);
        if (debt == 0 || ownerBalance == 0) return;
        uint256 amount = bound(uint256(seed), 1, _min(debt, ownerBalance));
        _callAs(owner, abi.encodeCall(account.ownerRepay, (amount)));
    }

    function ownerWithdrawCollateral(uint96 seed) external {
        uint256 current = morpho.position(Id.wrap(account.marketId()), address(account)).collateral;
        if (current == 0) return;
        uint256 amount = bound(uint256(seed), 1, current);
        _callAs(owner, abi.encodeCall(account.withdrawCollateral, (amount, owner)));
    }

    function ownerWithdrawReserve(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 reserve = account.idleReserveAssets();
        if (reserve <= c.reserveFloorAssets) return;
        uint256 amount = bound(uint256(seed), 1, reserve - c.reserveFloorAssets);
        if (_callAs(owner, abi.encodeCall(account.withdrawLoanToken, (amount, owner)))) {
            assertGe(account.idleReserveAssets(), c.reserveFloorAssets);
        }
    }

    function ownerWithdrawStrategy(uint96 seed) external {
        uint256 strategy = account.strategyAssets();
        if (strategy == 0) return;
        uint256 amount = bound(uint256(seed), 1, strategy);
        _callAs(owner, abi.encodeCall(account.withdrawStrategy, (amount, owner, type(uint256).max)));
    }

    function ownerConfigure(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 collateralAssets = morpho.position(Id.wrap(account.marketId()), address(account)).collateral;
        uint256 debt = account.currentDebtAssets();
        uint256 strategy = account.strategyAssets();
        if (collateralAssets > c.maxCollateralAssets) c.maxCollateralAssets = uint128(collateralAssets);
        if (debt > c.debtCeilingAssets) c.debtCeilingAssets = uint128(debt);
        if (strategy > c.maxStrategyAssets) c.maxStrategyAssets = uint128(strategy);
        c.maxRepayPerActionAssets = uint128(bound(uint256(seed), 1, 100e6));
        _callAs(owner, abi.encodeCall(account.configure, (c)));
    }

    function ownerSetGuardian(bool revoke) external {
        _callAs(owner, abi.encodeCall(account.setGuardian, (revoke ? address(0) : guardian)));
    }

    function ownerFreeze() external {
        _callAs(owner, abi.encodeCall(account.freezeBorrowing, ()));
    }

    function ownerUnfreeze() external {
        _callAs(owner, abi.encodeCall(account.unfreezeBorrowing, ()));
    }

    function guardianFreeze() external {
        _callAs(guardian, abi.encodeCall(account.freezeBorrowing, ()));
    }

    function guardianRepayFromReserve(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 debt = account.currentDebtAssets();
        uint256 reserve = account.idleReserveAssets();
        if (account.guardian() != guardian || debt == 0 || reserve <= c.reserveFloorAssets) return;
        uint256 maximum = _min(c.maxRepayPerActionAssets, _min(debt, reserve - c.reserveFloorAssets));
        if (maximum == 0) return;
        uint256 amount = bound(uint256(seed), 1, maximum);
        uint256 guardianLoanBefore = loan.balanceOf(guardian);
        uint256 guardianSharesBefore = vault.balanceOf(guardian);
        if (_callAs(guardian, abi.encodeCall(account.repayFromReserve, (amount)))) {
            ++successfulReserveRepay;
            lastReserveDebtBefore = debt;
            lastReserveDebtAfter = account.currentDebtAssets();
            lastReserveAfter = account.idleReserveAssets();
            lastReserveFloor = c.reserveFloorAssets;
            lastReserveCap = c.maxRepayPerActionAssets;
            lastReserveGuardianLoanBefore = guardianLoanBefore;
            lastReserveGuardianLoanAfter = loan.balanceOf(guardian);
            lastReserveGuardianSharesBefore = guardianSharesBefore;
            lastReserveGuardianSharesAfter = vault.balanceOf(guardian);
        }
    }

    function guardianRepayFromStrategy(uint96 seed) external {
        CrestAccount.PolicyConfig memory c = account.policy();
        uint256 debt = account.currentDebtAssets();
        uint256 strategy = account.strategyAssets();
        uint256 available = account.maxWithdrawableStrategyAssets();
        if (account.guardian() != guardian || debt == 0 || strategy <= c.strategyFloorAssets) return;
        uint256 maximum = _min(c.maxRepayPerActionAssets, _min(debt, _min(available, strategy - c.strategyFloorAssets)));
        if (maximum == 0) return;
        uint256 amount = bound(uint256(seed), 1, maximum);
        uint256 reserveBefore = account.idleReserveAssets();
        uint256 guardianLoanBefore = loan.balanceOf(guardian);
        uint256 guardianSharesBefore = vault.balanceOf(guardian);
        if (_callAs(guardian, abi.encodeCall(account.repayFromStrategy, (amount)))) {
            ++successfulStrategyRepay;
            lastStrategyDebtBefore = debt;
            lastStrategyDebtAfter = account.currentDebtAssets();
            lastStrategyAfter = account.strategyAssets();
            lastStrategyFloor = c.strategyFloorAssets;
            lastStrategyCap = c.maxRepayPerActionAssets;
            lastStrategyReserveBefore = reserveBefore;
            lastStrategyReserveAfter = account.idleReserveAssets();
            lastStrategyGuardianLoanBefore = guardianLoanBefore;
            lastStrategyGuardianLoanAfter = loan.balanceOf(guardian);
            lastStrategyGuardianSharesBefore = guardianSharesBefore;
            lastStrategyGuardianSharesAfter = vault.balanceOf(guardian);
        }
    }

    function fundReserve(uint96 seed) external {
        loan.mint(address(account), bound(uint256(seed), 1, 100e6));
    }

    function donateVaultYield(uint96 seed) external {
        uint256 amount = bound(uint256(seed), 1, 100e6);
        if (loan.balanceOf(owner) < amount) loan.mint(owner, amount);
        vm.prank(owner);
        loan.approve(address(vault), amount);
        vm.prank(owner);
        vault.donate(amount);
    }

    function realizeVaultLoss(uint96 seed) external {
        uint256 assets = vault.accountedAssets();
        if (assets == 0) return;
        vault.realizeLoss(bound(uint256(seed), 1, _min(assets, 100e6)));
    }

    function setVaultLiquidity(uint96 seed) external {
        vault.setGates((seed & 1) != 0, (seed & 2) != 0, (seed & 4) != 0);
        vault.setWithdrawalLimit(uint256(seed) % (100e6 + 1));
    }

    function accrueInterest(uint64 secondsElapsed, uint64 rate) external {
        irm.setBorrowRatePerSecondWad(bound(uint256(rate), 0, 1e12));
        vm.warp(block.timestamp + bound(uint256(secondsElapsed), 0, 1 days));
    }

    function attemptForbiddenOwnerAction(uint8 kind, bool asGuardian) external {
        address actor = asGuardian ? guardian : stranger;
        bytes memory callData;
        if (kind % 7 == 0) callData = abi.encodeCall(account.supplyCollateral, (1));
        else if (kind % 7 == 1) callData = abi.encodeCall(account.borrowAndDeploy, (1, 0));
        else if (kind % 7 == 2) callData = abi.encodeCall(account.depositToStrategy, (1, 0));
        else if (kind % 7 == 3) callData = abi.encodeCall(account.ownerRepay, (1));
        else if (kind % 7 == 4) callData = abi.encodeCall(account.withdrawCollateral, (1, actor));
        else if (kind % 7 == 5) callData = abi.encodeCall(account.withdrawLoanToken, (1, actor));
        else callData = abi.encodeCall(account.withdrawStrategy, (1, actor, type(uint256).max));
        if (_callAs(actor, callData)) ++forbiddenOwnerCallSucceeded;
    }

    function attemptForbiddenGuardianAction(uint8 kind) external {
        bytes memory callData = kind % 3 == 0
            ? abi.encodeCall(account.freezeBorrowing, ())
            : kind % 3 == 1
                ? abi.encodeCall(account.repayFromReserve, (1))
                : abi.encodeCall(account.repayFromStrategy, (1));
        if (_callAs(stranger, callData)) ++forbiddenGuardianCallSucceeded;
    }

    function attemptRevokedGuardianAction(uint8 kind) external {
        if (account.guardian() != address(0)) return;
        bytes memory callData = kind % 3 == 0
            ? abi.encodeCall(account.freezeBorrowing, ())
            : kind % 3 == 1
                ? abi.encodeCall(account.repayFromReserve, (1))
                : abi.encodeCall(account.repayFromStrategy, (1));
        if (_callAs(guardian, callData)) ++revokedGuardianCallSucceeded;
    }

    function _callAs(address actor, bytes memory callData) private returns (bool ok) {
        vm.prank(actor);
        (ok,) = address(account).call(callData);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

contract CrestInvariantTest is CrestFixture {
    CrestAccountHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CrestAccountHandler(account, morpho, vault, loan, irm, owner, guardian, stranger);

        bytes4[] memory selectors = new bytes4[](22);
        selectors[0] = CrestAccountHandler.ownerSupplyCollateral.selector;
        selectors[1] = CrestAccountHandler.ownerBorrowAndDeploy.selector;
        selectors[2] = CrestAccountHandler.ownerDepositToStrategy.selector;
        selectors[3] = CrestAccountHandler.ownerRepay.selector;
        selectors[4] = CrestAccountHandler.ownerWithdrawCollateral.selector;
        selectors[5] = CrestAccountHandler.ownerWithdrawReserve.selector;
        selectors[6] = CrestAccountHandler.ownerWithdrawStrategy.selector;
        selectors[7] = CrestAccountHandler.ownerConfigure.selector;
        selectors[8] = CrestAccountHandler.ownerSetGuardian.selector;
        selectors[9] = CrestAccountHandler.ownerFreeze.selector;
        selectors[10] = CrestAccountHandler.ownerUnfreeze.selector;
        selectors[11] = CrestAccountHandler.guardianFreeze.selector;
        selectors[12] = CrestAccountHandler.guardianRepayFromReserve.selector;
        selectors[13] = CrestAccountHandler.guardianRepayFromStrategy.selector;
        selectors[14] = CrestAccountHandler.fundReserve.selector;
        selectors[15] = CrestAccountHandler.donateVaultYield.selector;
        selectors[16] = CrestAccountHandler.realizeVaultLoss.selector;
        selectors[17] = CrestAccountHandler.setVaultLiquidity.selector;
        selectors[18] = CrestAccountHandler.accrueInterest.selector;
        selectors[19] = CrestAccountHandler.attemptForbiddenOwnerAction.selector;
        selectors[20] = CrestAccountHandler.attemptForbiddenGuardianAction.selector;
        selectors[21] = CrestAccountHandler.attemptRevokedGuardianAction.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_fixedRouteAndResidualApprovals() public view {
        CrestAccount.PolicyConfig memory c = account.policy();
        assertEq(address(account.morpho()), address(morpho));
        assertEq(account.marketId(), keccak256(abi.encode(market)));
        assertEq(keccak256(abi.encode(c.market)), keccak256(abi.encode(market)));
        assertEq(c.market.loanToken, address(loan));
        assertEq(c.market.collateralToken, address(collateral));
        assertEq(account.loanToken(), address(loan));
        assertEq(account.collateralToken(), address(collateral));
        assertEq(account.yieldVault(), address(vault));
        assertEq(account.guardian(), c.guardian);
        assertCleanApprovals();
    }

    function invariant_nonOwnersNeverGainAuthority() public view {
        assertEq(handler.forbiddenOwnerCallSucceeded(), 0);
        assertEq(handler.forbiddenGuardianCallSucceeded(), 0);
        assertEq(handler.revokedGuardianCallSucceeded(), 0);
    }

    function invariant_frozenBorrowingNeverSucceeds() public view {
        assertEq(handler.frozenBorrowSucceeded(), 0);
    }

    function invariant_successfulSupplyRespectsCollateralCap() public view {
        if (handler.successfulSupply() == 0) return;
        assertLe(handler.lastSupplyCollateral(), handler.lastSupplyCap());
    }

    function invariant_successfulBorrowUsesOnlyTheFixedVaultAndCaps() public view {
        if (handler.successfulBorrow() == 0) return;
        assertLe(handler.lastBorrowDebtAfter(), handler.lastBorrowDebtCap());
        assertLe(handler.lastBorrowStrategyAfter(), handler.lastBorrowStrategyCap());
        assertEq(handler.lastBorrowReserveAfter(), handler.lastBorrowReserveBefore());
        assertEq(handler.lastBorrowVaultLoanAfter(), handler.lastBorrowVaultLoanBefore() + handler.lastBorrowedAssets());
        assertEq(handler.lastBorrowGuardianLoanAfter(), handler.lastBorrowGuardianLoanBefore());
    }

    function invariant_successfulOwnerDepositRespectsStrategyCap() public view {
        if (handler.successfulDeposit() == 0) return;
        assertLe(handler.lastDepositStrategyAfter(), handler.lastDepositStrategyCap());
    }

    function invariant_successfulReserveRepayReducesDebtWithoutExtraction() public view {
        if (handler.successfulReserveRepay() == 0) return;
        assertLt(handler.lastReserveDebtAfter(), handler.lastReserveDebtBefore());
        assertGe(handler.lastReserveAfter(), handler.lastReserveFloor());
        assertLe(handler.lastReserveDebtBefore() - handler.lastReserveDebtAfter(), handler.lastReserveCap());
        assertEq(handler.lastReserveGuardianLoanAfter(), handler.lastReserveGuardianLoanBefore());
        assertEq(handler.lastReserveGuardianSharesAfter(), handler.lastReserveGuardianSharesBefore());
    }

    function invariant_successfulStrategyRepayReducesDebtWithoutExtraction() public view {
        if (handler.successfulStrategyRepay() == 0) return;
        assertLt(handler.lastStrategyDebtAfter(), handler.lastStrategyDebtBefore());
        assertGe(handler.lastStrategyAfter(), handler.lastStrategyFloor());
        assertLe(handler.lastStrategyDebtBefore() - handler.lastStrategyDebtAfter(), handler.lastStrategyCap());
        assertEq(handler.lastStrategyReserveAfter(), handler.lastStrategyReserveBefore());
        assertEq(handler.lastStrategyGuardianLoanAfter(), handler.lastStrategyGuardianLoanBefore());
        assertEq(handler.lastStrategyGuardianSharesAfter(), handler.lastStrategyGuardianSharesBefore());
    }

    function test_nonvacuousDeterministicOwnerGuardianSequence() public {
        uint64 nonceBefore = account.policyNonce();
        vm.prank(owner);
        account.configure(config());
        assertEq(account.policyNonce(), nonceBefore + 1);
        vm.prank(owner);
        account.setGuardian(address(0));
        vm.prank(guardian);
        vm.expectRevert(CrestAccount.Unauthorized.selector);
        account.freezeBorrowing();
        vm.prank(owner);
        account.setGuardian(guardian);

        handler.ownerSupplyCollateral(10e18);
        handler.ownerBorrowAndDeploy(100e6);
        loan.mint(address(account), 110e6);
        handler.guardianRepayFromReserve(50e6);
        handler.guardianRepayFromStrategy(25e6);
        assertEq(handler.successfulSupply(), 1);
        assertEq(handler.successfulBorrow(), 1);
        assertEq(handler.successfulReserveRepay(), 1);
        assertEq(handler.successfulStrategyRepay(), 1);
        invariant_fixedRouteAndResidualApprovals();
        invariant_successfulBorrowUsesOnlyTheFixedVaultAndCaps();
        invariant_successfulReserveRepayReducesDebtWithoutExtraction();
        invariant_successfulStrategyRepayReducesDebtWithoutExtraction();
    }
}
