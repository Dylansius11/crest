// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IMorpho, Id, Market, MarketParams, Position} from "morpho-blue/src/interfaces/IMorpho.sol";
import {DeployCrestAccount} from "../script/DeployCrestAccount.s.sol";
import {MorphoBalancesLib} from "morpho-blue/src/libraries/periphery/MorphoBalancesLib.sol";
import {VaultV2Liquidity} from "../src/libraries/VaultV2Liquidity.sol";
import {CrestAccount} from "../src/CrestAccount.sol";

interface IArbSysFork {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 number) external view returns (bytes32);
}

contract ForkEvidenceHarness is DeployCrestAccount {
    function validateEvidenceOnly(string memory json, uint256 number, bytes32 hash) external {
        ManifestRoute memory route;
        route.evidenceBlock = number;
        route.evidenceBlockHash = hash;
        _validateEvidence(json, route);
    }
}

contract RobinhoodForkTest is Test {
    using stdJson for string;
    using MorphoBalancesLib for IMorpho;

    string internal constant MANIFEST_PATH = "../config/deployment-manifest.json";
    uint256 internal constant COLLATERAL_ASSETS = 10 ether;
    uint256 internal constant BORROW_ASSETS = 1_000e6;

    string internal manifest;
    uint256 internal evidenceBlock;
    uint256 internal forkBlock;
    bytes32 internal marketId;
    address internal owner = makeAddr("fork owner");
    address internal guardian = makeAddr("fork guardian");

    IMorpho internal morpho;
    IERC20 internal collateral;
    IERC20 internal loan;
    IERC4626 internal vault;
    MarketParams internal marketParams;
    CrestAccount internal account;

    function setUp() public {
        manifest = vm.readFile(MANIFEST_PATH);
        evidenceBlock = _manifestUint(".evidence.block.number");
        forkBlock = _manifestUint(".forkProof.blockNumber");
        // Public nodes prune old state, so the lifecycle runs at the manifest's pinned proof block, which sits
        // at or after the finalized evidence block. Reads default to the local retrying proxy (`pnpm fork:proxy`),
        // which pins the official endpoint's real IP; `CREST_FORK_RPC` overrides it.
        string memory rpc = vm.envOr("CREST_FORK_RPC", string("http://127.0.0.1:8599"));
        vm.createSelectFork(rpc, forkBlock);
        assertEq(block.chainid, _manifestUint(".network.chainId"), "wrong fork chain");
        assertEq(IArbSysFork(address(100)).arbBlockNumber(), forkBlock, "wrong pinned L2 block");
        new ForkEvidenceHarness().validateEvidenceOnly(
            manifest, evidenceBlock, manifest.readBytes32(".evidence.block.hash")
        );

        morpho = IMorpho(manifest.readAddress(".contracts.morpho.address"));
        collateral = IERC20(manifest.readAddress(".contracts.collateralToken.address"));
        loan = IERC20(manifest.readAddress(".contracts.loanToken.address"));
        vault = IERC4626(manifest.readAddress(".vault.address"));
        marketParams = MarketParams({
            loanToken: address(loan),
            collateralToken: address(collateral),
            oracle: manifest.readAddress(".market.oracle"),
            irm: manifest.readAddress(".market.irm"),
            lltv: _manifestUint(".market.lltv")
        });
        marketId = keccak256(abi.encode(marketParams));
        assertEq(marketId, manifest.readBytes32(".market.id"), "wrong market params");
        assertEq(vault.asset(), address(loan), "wrong vault asset");

        vm.deal(owner, 10 ether);
        vm.deal(guardian, 1 ether);
        deal(address(collateral), owner, COLLATERAL_ASSETS, true);

        vm.startPrank(owner);
        account = new CrestAccount(owner, address(morpho));
        account.configure(_policy());
        vm.stopPrank();
    }

    function testPinnedSupplyBorrowDeployUsesExactManifestRoute() public {
        Market memory marketBefore = morpho.market(Id.wrap(marketId));
        uint256 expectedShares = vault.previewDeposit(BORROW_ASSETS);

        vm.startPrank(owner);
        collateral.approve(address(account), COLLATERAL_ASSETS);
        account.supplyCollateral(COLLATERAL_ASSETS);
        account.borrowAndDeploy(BORROW_ASSETS, expectedShares);
        vm.stopPrank();

        Position memory position = morpho.position(Id.wrap(marketId), address(account));
        Market memory marketAfter = morpho.market(Id.wrap(marketId));
        assertEq(position.collateral, COLLATERAL_ASSETS, "collateral mismatch");
        assertGt(position.borrowShares, 0, "missing debt shares");
        assertEq(uint256(marketAfter.totalBorrowAssets), uint256(marketBefore.totalBorrowAssets) + BORROW_ASSETS, "borrow assets mismatch");
        assertEq(vault.balanceOf(address(account)), expectedShares, "vault shares mismatch");
        assertEq(loan.balanceOf(address(account)), 0, "borrow receiver drift");
        // Morpho converts borrow shares back to assets with round-up virtual-share math, so the account's
        // canonical debt is the borrowed amount plus at most one wei of rounding dust.
        uint256 expectedDebt = morpho.expectedBorrowAssets(marketParams, address(account));
        assertEq(account.currentDebtAssets(), expectedDebt, "debt mismatch");
        assertLe(expectedDebt - BORROW_ASSETS, 1, "debt rounding drift");
        assertEq(account.strategyAssets(), vault.convertToAssets(expectedShares), "strategy accounting mismatch");
    }

    function testGuardianCannotBorrowAndFreezeStopsOwnerBorrowing() public {
        _openPosition();

        // Debt creation and unfreezing are `onlyOwner`, so the Guardian is rejected by Ownable itself.
        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        account.borrowAndDeploy(1e6, 0);

        vm.prank(guardian);
        account.freezeBorrowing();
        assertTrue(account.borrowingFrozen(), "freeze not recorded");

        vm.prank(owner);
        vm.expectRevert(CrestAccount.BorrowingIsFrozen.selector);
        account.borrowAndDeploy(1e6, 0);

        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        account.unfreezeBorrowing();

        vm.prank(owner);
        account.unfreezeBorrowing();
        assertFalse(account.borrowingFrozen(), "owner unfreeze failed");
    }

    function testDebtCeilingUsesFreshAccruedDebt() public {
        _openPosition();
        uint256 headroom = uint256(account.policy().debtCeilingAssets) - account.currentDebtAssets();

        // Interest accrues on the live IRM, so the ceiling check must price debt at the current block.
        vm.warp(block.timestamp + 180 days);
        morpho.accrueInterest(marketParams);
        uint256 accruedDebt = account.currentDebtAssets();
        assertGt(accruedDebt, BORROW_ASSETS, "no interest accrued on the live market");

        uint256 ceiling = uint256(account.policy().debtCeilingAssets);
        bytes memory expectedRevert =
            abi.encodeWithSelector(CrestAccount.DebtCeilingExceeded.selector, ceiling, accruedDebt + headroom);

        vm.prank(owner);
        vm.expectRevert(expectedRevert);
        account.borrowAndDeploy(headroom, 0);
    }

    function testStrategyRepaymentIsBoundedByNativeVaultLiquidity() public {
        _openPosition();
        uint256 liquidity = account.maxWithdrawableStrategyAssets();
        assertEq(vault.maxWithdraw(address(account)), 0, "Vault V2 max functions are not zero");
        assertGt(liquidity, 0, "no native vault withdrawal liquidity");

        uint256 perAction = uint256(account.policy().maxRepayPerActionAssets);
        uint256 aboveFloor = account.strategyAssets() - uint256(account.policy().strategyFloorAssets);
        uint256 expected = _min(_min(perAction, aboveFloor), _min(liquidity, account.currentDebtAssets()));

        uint256 debtBefore = account.currentDebtAssets();
        uint256 strategyBefore = account.strategyAssets();
        uint256 reserveBefore = account.idleReserveAssets();

        vm.prank(guardian);
        account.repayFromStrategy(type(uint256).max);

        assertApproxEqAbs(debtBefore - account.currentDebtAssets(), expected, 1, "strategy repayment amount drift");
        assertApproxEqAbs(strategyBefore - account.strategyAssets(), expected, 1, "strategy balance drift");
        assertEq(account.idleReserveAssets(), reserveBefore, "withdrawn assets left the repayment path");
        assertGe(account.strategyAssets(), uint256(account.policy().strategyFloorAssets), "strategy floor broken");
    }

    function testReserveRepaymentReducesDebtAndHoldsFloor() public {
        _openPosition();
        uint256 floor = uint256(account.policy().reserveFloorAssets);
        deal(address(loan), address(account), floor + 300e6, true);

        uint256 debtBefore = account.currentDebtAssets();
        vm.prank(guardian);
        account.repayFromReserve(type(uint256).max);

        assertApproxEqAbs(debtBefore - account.currentDebtAssets(), 300e6, 1, "reserve repayment amount drift");
        assertEq(account.idleReserveAssets(), floor, "reserve floor broken");

        vm.prank(guardian);
        vm.expectRevert(CrestAccount.RepayAmountZero.selector);
        account.repayFromReserve(type(uint256).max);
    }

    function testOwnerExitClosesThePositionOnLiveProtocols() public {
        _openPosition();

        // Value only ever leaves to the owner: the account refuses itself as a withdrawal receiver, and the
        // owner funds the final repayment from their own balance.
        vm.startPrank(owner);
        account.withdrawStrategy(account.strategyAssets(), owner, type(uint256).max);
        uint256 debt = account.currentDebtAssets();
        deal(address(loan), owner, debt, true);
        loan.approve(address(account), debt);
        account.ownerRepay(type(uint256).max);
        assertEq(account.currentDebtAssets(), 0, "debt not cleared");

        account.withdrawCollateral(COLLATERAL_ASSETS, owner);
        vm.stopPrank();

        Position memory position = morpho.position(Id.wrap(marketId), address(account));
        assertEq(position.collateral, 0, "collateral not returned");
        assertEq(position.borrowShares, 0, "borrow shares remain");
        assertEq(collateral.balanceOf(owner), COLLATERAL_ASSETS, "owner did not receive collateral");
        // ERC-4626 burns round-up shares for an exact asset withdrawal, so sub-wei share dust remains; it is
        // worth zero loan-token assets and cannot be redeemed for value.
        assertEq(account.strategyAssets(), 0, "strategy value remains");
        assertLt(vault.convertToAssets(vault.balanceOf(address(account))), 1, "redeemable dust is not sub-wei");
    }

    /// @dev Full supply -> borrow-and-deploy -> Guardian repay -> owner exit run, whose measured amounts are
    /// written for `scripts/record-fork-lifecycle.ts`. The manifest gate may only be promoted from this file.
    function testRecordedLifecycleProducesManifestEvidence() public {
        uint256 vaultSharesBefore = vault.balanceOf(address(account));
        uint256 loanBefore = loan.balanceOf(address(account));
        _openPosition();

        uint256 mintedShares = vault.balanceOf(address(account)) - vaultSharesBefore;
        uint256 strategyDeposit = account.strategyAssets();
        uint256 vaultLiquidity = account.maxWithdrawableStrategyAssets();

        vm.prank(guardian);
        account.repayFromStrategy(type(uint256).max);
        uint256 strategyRepaid = strategyDeposit - account.strategyAssets();
        uint256 sharesAfterRepay = vault.balanceOf(address(account));

        vm.startPrank(owner);
        uint256 remainingStrategy = account.strategyAssets();
        account.withdrawStrategy(remainingStrategy, owner, type(uint256).max);
        uint256 debt = account.currentDebtAssets();
        deal(address(loan), owner, debt, true);
        loan.approve(address(account), debt);
        account.ownerRepay(type(uint256).max);
        account.withdrawCollateral(COLLATERAL_ASSETS, owner);
        vm.stopPrank();

        assertEq(account.currentDebtAssets(), 0, "lifecycle left debt");
        assertEq(loan.balanceOf(address(account)), loanBefore, "lifecycle left loan tokens in the account");

        string memory record = "forkLifecycle";
        vm.serializeUint(record, "blockNumber", forkBlock);
        vm.serializeUint(record, "collateralAssets", COLLATERAL_ASSETS);
        vm.serializeUint(record, "borrowAssets", BORROW_ASSETS);
        vm.serializeUint(record, "repaidAssets", strategyRepaid + debt);
        vm.serializeUint(record, "withdrawnCollateralAssets", COLLATERAL_ASSETS);
        vm.serializeUint(record, "depositAssets", strategyDeposit);
        vm.serializeUint(record, "mintedShares", mintedShares);
        vm.serializeUint(record, "withdrawAssets", strategyRepaid);
        vm.serializeUint(record, "withdrawnShares", mintedShares - sharesAfterRepay);
        vm.serializeUint(record, "redeemedAssets", remainingStrategy);
        vm.serializeUint(record, "redeemedShares", sharesAfterRepay - vault.balanceOf(address(account)));
        vm.serializeUint(record, "finalShares", vault.balanceOf(address(account)));
        vm.serializeUint(record, "vaultWithdrawableAssets", _vaultCapacity());
        vm.serializeUint(record, "marketLiquidityAssets", _marketLiquidity());
        vm.serializeBool(record, "assetBalanceRestored", loan.balanceOf(address(account)) == loanBefore);
        string memory json = vm.serializeString(record, "test", "testRecordedLifecycleProducesManifestEvidence");
        vm.writeJson(json, "../.tmp/fork-lifecycle.json");
    }

    function _marketLiquidity() internal view returns (uint256) {
        Market memory market = morpho.market(Id.wrap(marketId));
        return uint256(market.totalSupplyAssets) - uint256(market.totalBorrowAssets);
    }

    /// @dev Vault-wide withdrawal capacity, the manifest's `vault.withdrawableAssets` fact.
    function _vaultCapacity() internal view returns (uint256) {
        return VaultV2Liquidity.vaultCapacity(
            address(vault), address(morpho), account.vaultLiquidityAdapter(), account.vaultLiquidityDataHash()
        );
    }

    function testPolicyCapsAndReceiverRulesHoldOnLiveProtocols() public {
        _openPosition();
        uint256 cap = uint256(account.policy().maxCollateralAssets);

        deal(address(collateral), owner, 1 ether, true);
        vm.startPrank(owner);
        collateral.approve(address(account), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(CrestAccount.CollateralCapExceeded.selector, cap, cap + 1 ether));
        account.supplyCollateral(1 ether);

        // Value may only leave to a third-party receiver: the account and the zero address are refused.
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.withdrawCollateral(1, address(account));
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.withdrawStrategy(1, address(0), type(uint256).max);
        vm.expectRevert(CrestAccount.InvalidConfiguration.selector);
        account.withdrawLoanToken(1, address(account));
        vm.stopPrank();
    }

    function _openPosition() internal {
        vm.startPrank(owner);
        collateral.approve(address(account), COLLATERAL_ASSETS);
        account.supplyCollateral(COLLATERAL_ASSETS);
        account.borrowAndDeploy(BORROW_ASSETS, vault.previewDeposit(BORROW_ASSETS));
        vm.stopPrank();
    }

    function _min(uint256 left, uint256 right) internal pure returns (uint256) {
        return left < right ? left : right;
    }

    function _policy() internal view returns (CrestAccount.PolicyConfig memory) {
        return CrestAccount.PolicyConfig({
            market: marketParams,
            yieldVault: address(vault),
            maxCollateralAssets: uint128(COLLATERAL_ASSETS),
            debtCeilingAssets: uint128(2_000e6),
            maxStrategyAssets: uint128(2_000e6),
            reserveFloorAssets: uint128(100e6),
            strategyFloorAssets: uint128(100e6),
            maxRepayPerActionAssets: uint128(500e6),
            lowerLtvWad: uint64(0.20e18),
            targetLtvWad: uint64(0.30e18),
            upperLtvWad: uint64(0.40e18),
            criticalLtvWad: uint64(0.50e18),
            guardian: guardian
        });
    }

    function _manifestUint(string memory path) internal view returns (uint256) {
        return vm.parseUint(manifest.readString(path));
    }
}
