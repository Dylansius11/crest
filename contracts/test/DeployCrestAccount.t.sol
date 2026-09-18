// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {CrestFixture} from "./CrestAccount.t.sol";
import {CrestAccount} from "../src/CrestAccount.sol";
import {DeployCrestAccount} from "../script/DeployCrestAccount.s.sol";
import {MockVault} from "./mocks/MockVault.sol";

contract ManifestVault is MockVault {
    constructor(address asset_) MockVault(asset_) {}

    function isAdapter(address adapter) external view returns (bool) {
        return adapter == liquidityAdapter;
    }
}

contract ManifestAdapter {
    address public immutable parentVault;
    address public immutable asset;
    address public immutable morpho;
    address public immutable adaptiveCurveIrm;

    constructor(address vault_, address asset_, address morpho_, address irm_) {
        parentVault = vault_;
        asset = asset_;
        morpho = morpho_;
        adaptiveCurveIrm = irm_;
    }
}


contract DeployCrestAccountHarness is DeployCrestAccount {
    function deployForTest(DeploymentParameters memory parameters, string memory manifestJson)
        external
        returns (CrestAccount)
    {
        return _deploy(parameters, manifestJson);
    }
}

contract DeployCrestAccountTest is CrestFixture {
    DeployCrestAccountHarness internal deployer;
    ManifestVault internal manifestVault;
    ManifestAdapter internal adapter;
    uint256 internal manifestChain;
    uint256 internal evidenceBlock;
    bytes32 internal evidenceHash;
    bool internal evidenceFinalized;
    bytes32 internal morphoHash;
    bytes32 internal liquidityId;
    address internal manifestAsset;
    string internal morphoLifecycle;
    string internal vaultLifecycle;
    string internal gateOutcome;

    function setUp() public override {
        super.setUp();
        manifestVault = new ManifestVault(address(loan));
        adapter = new ManifestAdapter(address(manifestVault), address(loan), address(morpho), address(irm));
        manifestVault.setLiquidityAdapter(address(adapter), abi.encode(market));
        deployer = new DeployCrestAccountHarness();
        manifestChain = block.chainid;
        evidenceBlock = block.number;
        evidenceHash = bytes32(uint256(1));
        evidenceFinalized = true;
        vm.roll(evidenceBlock + 1);
        vm.setBlockhash(evidenceBlock, evidenceHash);
        morphoHash = address(morpho).codehash;
        liquidityId = keccak256(abi.encode(market));
        manifestAsset = address(loan);
        morphoLifecycle = "passed";
        vaultLifecycle = "passed";
        gateOutcome = "full_route";
    }

    function testDeploymentAuthorizationAndConfiguredBroadcastSequence() public {
        string memory json = manifest();
        vm.setEnv("CREST_BROADCAST", "false");
        vm.expectRevert(DeployCrestAccount.BroadcastFlagRequired.selector);
        deployer.deployForTest(parameters(owner), json);

        vm.setEnv("CREST_BROADCAST", "true");
        vm.chainId(4663);
        json = manifest();
        vm.expectRevert(DeployCrestAccount.MainnetBroadcastNotAuthorized.selector);
        deployer.deployForTest(parameters(owner), json);

        vm.chainId(manifestChain);
        json = manifest();
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployCrestAccount.BroadcasterIsNotInitialOwner.selector, tx.origin, address(0xA11CE)
            )
        );
        deployer.deployForTest(parameters(address(0xA11CE)), json);

        CrestAccount deployed = deployer.deployForTest(parameters(tx.origin), json);
        assertEq(deployed.owner(), tx.origin);
        assertEq(deployed.marketId(), keccak256(abi.encode(market)));
        assertEq(deployed.vaultLiquidityAdapter(), address(adapter));
        assertEq(deployed.vaultLiquidityDataHash(), liquidityId);
        assertEq(deployed.policyNonce(), 1);
        assertEq(deployed.guardian(), guardian);
        vm.prank(tx.origin);
        deployed.freezeBorrowing();
        assertTrue(deployed.borrowingFrozen());
    }


    function testManifestRejectsFutureEvidence() public {
        evidenceBlock = block.number + 1;
        string memory json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
    }

    function testManifestRejectsStaleUnverifiableEvidence() public {
        vm.roll(block.number + 257);
        string memory json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
    }

    function testManifestRejectsWrongRecentBlockHashAndUnfinalizedEvidence() public {
        evidenceHash = bytes32(uint256(2));
        string memory json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);

        evidenceHash = bytes32(uint256(1));
        evidenceFinalized = false;
        json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
    }

    function testManifestRejectsChainAndCodeHashMismatches() public {
        manifestChain += 1;
        string memory json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
        manifestChain = block.chainid;
        morphoHash = bytes32(0);
        json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
    }

    function testManifestRejectsVaultAndLiquidityRouteMismatches() public {
        manifestAsset = address(collateral);
        string memory json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
        manifestAsset = address(loan);
        liquidityId = bytes32(uint256(42));
        json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
    }

    function testManifestRejectsEmptyRuntimeEvenWithMatchingHash() public {
        vm.etch(address(morpho), "");
        morphoHash = address(morpho).codehash;
        string memory json = manifest();
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(json);
    }

    function testManifestRejectsUnexecutedOrDegradedLifecycleEvidence() public {
        morphoLifecycle = "not_executed";
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(manifest());

        morphoLifecycle = "passed";
        vaultLifecycle = "failed";
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(manifest());

        // A reserve-only route is a valid gate outcome, but it must not deploy the yield-loop configuration.
        vaultLifecycle = "passed";
        gateOutcome = "reserve_only";
        vm.expectRevert(DeployCrestAccount.ManifestRejected.selector);
        deployer.validateManifest(manifest());
    }

    function testParametersRejectUnsafeUint128AndUint64Downcasts() public {
        vm.setEnv("CREST_OWNER", vm.toString(owner));
        vm.setEnv("CREST_GUARDIAN", vm.toString(guardian));
        vm.setEnv("CREST_MAX_COLLATERAL_ASSETS", vm.toString(type(uint256).max));
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(128), type(uint256).max)
        );
        deployer.parametersFromEnv();

        vm.setEnv("CREST_MAX_COLLATERAL_ASSETS", "1");
        vm.setEnv("CREST_DEBT_CEILING_ASSETS", "1");
        vm.setEnv("CREST_MAX_STRATEGY_ASSETS", "1");
        vm.setEnv("CREST_RESERVE_FLOOR_ASSETS", "1");
        vm.setEnv("CREST_STRATEGY_FLOOR_ASSETS", "1");
        vm.setEnv("CREST_MAX_REPAY_PER_ACTION_ASSETS", "1");
        vm.setEnv("CREST_LOWER_LTV_WAD", vm.toString(type(uint256).max));
        vm.expectRevert(
            abi.encodeWithSelector(SafeCast.SafeCastOverflowedUintDowncast.selector, uint8(64), type(uint256).max)
        );
        deployer.parametersFromEnv();
    }

    function parameters(address initialOwner) internal view returns (DeployCrestAccount.DeploymentParameters memory p) {
        CrestAccount.PolicyConfig memory c = config();
        p = DeployCrestAccount.DeploymentParameters(
            initialOwner,
            guardian,
            c.maxCollateralAssets,
            c.debtCeilingAssets,
            c.maxStrategyAssets,
            c.reserveFloorAssets,
            c.strategyFloorAssets,
            c.maxRepayPerActionAssets,
            c.lowerLtvWad,
            c.targetLtvWad,
            c.upperLtvWad,
            c.criticalLtvWad
        );
    }

    function manifest() internal returns (string memory) {
        string memory codes = string.concat(
            '{"morpho":',
            code(address(morpho), morphoHash),
            ',"loanToken":',
            code(address(loan), address(loan).codehash),
            ',"collateralToken":',
            code(address(collateral), address(collateral).codehash),
            ',"oracle":',
            code(address(irm), address(irm).codehash),
            ',"irm":',
            code(address(irm), address(irm).codehash),
            ',"vault":',
            code(address(manifestVault), address(manifestVault).codehash),
            ',"vaultAdapter":',
            code(address(adapter), address(adapter).codehash),
            "}"
        );
        vm.serializeAddress("market", "loanToken", address(loan));
        vm.serializeAddress("market", "collateralToken", address(collateral));
        vm.serializeAddress("market", "oracle", address(irm));
        vm.serializeAddress("market", "irm", address(irm));
        vm.serializeString("market", "lltv", vm.toString(market.lltv));
        vm.serializeBytes32("market", "id", keccak256(abi.encode(market)));
        vm.serializeBytes32("market", "derivedId", keccak256(abi.encode(market)));
        vm.serializeString("market", "liquidityAssets", "1");
        string memory marketJson = vm.serializeString("market", "plannedBorrowAssets", "1");
        string memory vaultJson = string.concat(
            '{"address":"',
            vm.toString(address(manifestVault)),
            '","codeHash":"',
            vm.toString(address(manifestVault).codehash),
            '","asset":"',
            vm.toString(manifestAsset),
            '","generation":"Morpho Vault V2","governance":{"liquidityAdapter":"',
            vm.toString(address(adapter)),
            '"},"maxFunctions":{"maxWithdraw":"0"},"plannedWithdrawalAssets":"1","withdrawableAssets":"1",',
            '"withdrawalOptions":{"idleAssets":"0","liquidityAdapterAvailable":"1"},',
            '"downstreamAllocations":[{"adapter":"',
            vm.toString(address(adapter)),
            '","marketId":"',
            vm.toString(liquidityId),
            '","liquidityRole":"default"}]}'
        );
        string memory blockJson = string.concat(
            '{"number":"',
            vm.toString(evidenceBlock),
            '","hash":"',
            vm.toString(evidenceHash),
            '","finality":"',
            evidenceFinalized ? "finalized" : "unfinalized",
            '"}'
        );
        return string.concat(
            '{"schemaVersion":1,"network":{"chainId":',
            vm.toString(manifestChain),
            '},"contracts":',
            codes,
            ',"market":',
            marketJson,
            ',"vault":',
            vaultJson,
            ',"evidence":{"block":',
            blockJson,
            '},"forkProof":{"blockNumber":"',
            vm.toString(evidenceBlock),
            '","blockHash":"',
            vm.toString(evidenceHash),
            '","morphoLifecycle":"',
            morphoLifecycle,
            '","vaultLifecycle":"',
            vaultLifecycle,
            '"},"gate":{"outcome":"',
            gateOutcome,
            '","marketGate":"passed","vaultGate":"passed"}}'
        );
    }

    function code(address target, bytes32 codeHash) internal returns (string memory) {
        vm.serializeAddress("code", "address", target);
        return vm.serializeBytes32("code", "codeHash", codeHash);
    }
}
