// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Script} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {MarketParams} from "morpho-blue/src/interfaces/IMorpho.sol";
import {CrestAccount} from "../src/CrestAccount.sol";
import {IVaultV2, IMarketV1AdapterV2} from "../src/libraries/VaultV2Liquidity.sol";

interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
    function arbBlockHash(uint256 number) external view returns (bytes32);
}

/// @notice Deploys and configures one non-upgradeable Crest account from reviewed route evidence.
/// @dev Foundry's selected wallet must be `initialOwner`; this script never reads a private key.
contract DeployCrestAccount is Script {
    using stdJson for string;
    using SafeCast for uint256;

    string internal constant DEFAULT_MANIFEST = "../config/deployment-manifest.json";
    uint256 internal constant ROBINHOOD_CHAIN_ID = 4663;
    uint256 internal constant BLOCKHASH_HISTORY = 256;
    address internal constant ARBSYS = address(100);

    error BroadcastFlagRequired();
    error BroadcasterIsNotInitialOwner(address broadcaster, address initialOwner);
    error MainnetBroadcastNotAuthorized();
    error ManifestRejected();

    struct DeploymentParameters {
        address initialOwner;
        address guardian;
        uint128 maxCollateralAssets;
        uint128 debtCeilingAssets;
        uint128 maxStrategyAssets;
        uint128 reserveFloorAssets;
        uint128 strategyFloorAssets;
        uint128 maxRepayPerActionAssets;
        uint64 lowerLtvWad;
        uint64 targetLtvWad;
        uint64 upperLtvWad;
        uint64 criticalLtvWad;
    }

    struct ManifestRoute {
        address morpho;
        bytes32 morphoCodeHash;
        address loanToken;
        bytes32 loanTokenCodeHash;
        address collateralToken;
        bytes32 collateralTokenCodeHash;
        address oracle;
        bytes32 oracleCodeHash;
        address irm;
        bytes32 irmCodeHash;
        address vault;
        bytes32 vaultCodeHash;
        address adapter;
        bytes32 adapterCodeHash;
        MarketParams market;
        bytes32 marketId;
        bytes32 derivedMarketId;
        uint256 evidenceBlock;
        bytes32 evidenceBlockHash;
        bytes32 liquidityDataHash;
    }

    /// @notice Reads explicit non-secret policy inputs and deploys only after explicit broadcast authorization.
    function run() external returns (CrestAccount account) {
        account = _deploy(parametersFromEnv(), vm.readFile(DEFAULT_MANIFEST));
    }

    /// @notice Typed entrypoint for reviewable local simulations and deliberately authorized broadcasts.
    /// @dev Internal so `run()` is the only production broadcast entrypoint and always binds the reviewed file/env.
    function _deploy(DeploymentParameters memory parameters, string memory manifestJson)
        internal
        returns (CrestAccount account)
    {
        _authorizeBroadcast();
        ManifestRoute memory route = validateManifest(manifestJson);
        CrestAccount.PolicyConfig memory policy = _policy(parameters, route);

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        vm.stopBroadcast();
        if (broadcaster != parameters.initialOwner) {
            revert BroadcasterIsNotInitialOwner(broadcaster, parameters.initialOwner);
        }

        vm.startBroadcast();

        account = new CrestAccount(parameters.initialOwner, route.morpho);
        account.configure(policy);
        vm.stopBroadcast();
    }

    function parametersFromEnv() public view returns (DeploymentParameters memory parameters) {
        parameters.initialOwner = vm.envAddress("CREST_OWNER");
        parameters.guardian = vm.envAddress("CREST_GUARDIAN");
        parameters.maxCollateralAssets = vm.envUint("CREST_MAX_COLLATERAL_ASSETS").toUint128();
        parameters.debtCeilingAssets = vm.envUint("CREST_DEBT_CEILING_ASSETS").toUint128();
        parameters.maxStrategyAssets = vm.envUint("CREST_MAX_STRATEGY_ASSETS").toUint128();
        parameters.reserveFloorAssets = vm.envUint("CREST_RESERVE_FLOOR_ASSETS").toUint128();
        parameters.strategyFloorAssets = vm.envUint("CREST_STRATEGY_FLOOR_ASSETS").toUint128();
        parameters.maxRepayPerActionAssets = vm.envUint("CREST_MAX_REPAY_PER_ACTION_ASSETS").toUint128();
        parameters.lowerLtvWad = vm.envUint("CREST_LOWER_LTV_WAD").toUint64();
        parameters.targetLtvWad = vm.envUint("CREST_TARGET_LTV_WAD").toUint64();
        parameters.upperLtvWad = vm.envUint("CREST_UPPER_LTV_WAD").toUint64();
        parameters.criticalLtvWad = vm.envUint("CREST_CRITICAL_LTV_WAD").toUint64();
    }

    /// @notice Validates the reviewed manifest against the active chain before account creation/configuration.
    function validateManifest(string memory json) public returns (ManifestRoute memory route) {
        _require(_manifestUint(json, ".schemaVersion") == 1);
        _require(_manifestUint(json, ".network.chainId") == block.chainid);
        _require(_same(json.readString(".vault.generation"), "Morpho Vault V2"));
        _require(_same(json.readString(".gate.outcome"), "full_route"));
        _require(_same(json.readString(".gate.marketGate"), "passed"));
        _require(_same(json.readString(".gate.vaultGate"), "passed"));
        _require(_same(json.readString(".forkProof.morphoLifecycle"), "passed"));
        _require(_same(json.readString(".forkProof.vaultLifecycle"), "passed"));

        route.morpho = json.readAddress(".contracts.morpho.address");
        route.morphoCodeHash = json.readBytes32(".contracts.morpho.codeHash");
        route.loanToken = json.readAddress(".contracts.loanToken.address");
        route.loanTokenCodeHash = json.readBytes32(".contracts.loanToken.codeHash");
        route.collateralToken = json.readAddress(".contracts.collateralToken.address");
        route.collateralTokenCodeHash = json.readBytes32(".contracts.collateralToken.codeHash");
        route.oracle = json.readAddress(".contracts.oracle.address");
        route.oracleCodeHash = json.readBytes32(".contracts.oracle.codeHash");
        route.irm = json.readAddress(".contracts.irm.address");
        route.irmCodeHash = json.readBytes32(".contracts.irm.codeHash");
        route.vault = json.readAddress(".vault.address");
        route.vaultCodeHash = json.readBytes32(".vault.codeHash");
        route.adapter = json.readAddress(".contracts.vaultAdapter.address");
        route.adapterCodeHash = json.readBytes32(".contracts.vaultAdapter.codeHash");
        route.market = MarketParams({
            loanToken: json.readAddress(".market.loanToken"),
            collateralToken: json.readAddress(".market.collateralToken"),
            oracle: json.readAddress(".market.oracle"),
            irm: json.readAddress(".market.irm"),
            lltv: _manifestUint(json, ".market.lltv")
        });
        route.marketId = json.readBytes32(".market.id");
        route.derivedMarketId = json.readBytes32(".market.derivedId");
        route.evidenceBlock = _manifestUint(json, ".evidence.block.number");
        route.evidenceBlockHash = json.readBytes32(".evidence.block.hash");

        _verifiedCode(route.morpho, route.morphoCodeHash);
        _verifiedCode(route.loanToken, route.loanTokenCodeHash);
        _verifiedCode(route.collateralToken, route.collateralTokenCodeHash);
        _verifiedCode(route.oracle, route.oracleCodeHash);
        _verifiedCode(route.irm, route.irmCodeHash);
        _verifiedCode(route.vault, route.vaultCodeHash);
        _verifiedCode(route.adapter, route.adapterCodeHash);
        _require(route.market.loanToken == route.loanToken);
        _require(route.market.collateralToken == route.collateralToken);
        _require(route.market.oracle == route.oracle);
        _require(route.market.irm == route.irm);
        _require(keccak256(abi.encode(route.market)) == route.marketId);
        _require(route.marketId == route.derivedMarketId);
        _require(json.readAddress(".contracts.vault.address") == route.vault);
        _require(json.readBytes32(".contracts.vault.codeHash") == route.vaultCodeHash);
        _require(json.readAddress(".vault.asset") == route.loanToken);
        _require(_manifestUint(json, ".market.plannedBorrowAssets") > 0);
        _require(_manifestUint(json, ".market.plannedBorrowAssets") <= _manifestUint(json, ".market.liquidityAssets"));
        _require(_manifestUint(json, ".vault.plannedWithdrawalAssets") > 0);
        _require(
            _manifestUint(json, ".vault.plannedWithdrawalAssets") <= _manifestUint(json, ".vault.withdrawableAssets")
        );
        _require(
            _manifestUint(json, ".vault.withdrawableAssets")
                <= _manifestUint(json, ".vault.withdrawalOptions.idleAssets")
                    + _manifestUint(json, ".vault.withdrawalOptions.liquidityAdapterAvailable")
        );
        _require(_manifestUint(json, ".vault.maxFunctions.maxWithdraw") == 0);

        _validateEvidence(json, route);
        route.liquidityDataHash = _validateLiquidityRoute(json, route);
    }

    function _authorizeBroadcast() internal view {
        if (!vm.envOr("CREST_BROADCAST", false)) revert BroadcastFlagRequired();
        if (block.chainid == ROBINHOOD_CHAIN_ID && !vm.envOr("CREST_ALLOW_MAINNET_BROADCAST", false)) {
            revert MainnetBroadcastNotAuthorized();
        }
    }

    /// @dev Robinhood Chain finalizes thousands of blocks behind head, so finalized evidence can never sit
    ///      inside the 256-block hash window; there finality and the canonical hash come from the chain itself.
    function _validateEvidence(string memory json, ManifestRoute memory route) internal {
        _require(route.evidenceBlock != 0 && route.evidenceBlockHash != bytes32(0));
        _require(_same(json.readString(".evidence.block.finality"), "finalized"));
        uint256 forkBlock = _manifestUint(json, ".forkProof.blockNumber");
        bytes32 forkHash = json.readBytes32(".forkProof.blockHash");
        // Public nodes prune old state, so the lifecycle proof runs at or after the finalized evidence block.
        _require(forkBlock >= route.evidenceBlock && forkHash != bytes32(0));

        if (block.chainid != ROBINHOOD_CHAIN_ID) {
            _require(forkHash == route.evidenceBlockHash && forkBlock == route.evidenceBlock);
            _require(route.evidenceBlock < block.number);
            _require(block.number - route.evidenceBlock <= BLOCKHASH_HISTORY);
            _require(blockhash(route.evidenceBlock) == route.evidenceBlockHash);
            return;
        }

        _require(route.evidenceBlock < IArbSys(ARBSYS).arbBlockNumber());
        _require(vm.parseJsonBytes32(_rpcBlock(_rpcQuantity(route.evidenceBlock)), ".hash") == route.evidenceBlockHash);
        _require(vm.parseJsonBytes32(_rpcBlock(_rpcQuantity(forkBlock)), ".hash") == forkHash);
        _require(vm.parseJsonUint(_rpcBlock("finalized"), ".number") >= route.evidenceBlock);
    }

    function _rpcBlock(string memory tag) internal returns (string memory) {
        return vm.rpcJson("eth_getBlockByNumber", string.concat("[\"", tag, "\",false]"));
    }

    function _validateLiquidityRoute(string memory json, ManifestRoute memory route)
        internal
        view
        returns (bytes32 dataHash)
    {
        IVaultV2 vault = IVaultV2(route.vault);
        _require(json.readAddress(".vault.governance.liquidityAdapter") == route.adapter);
        _require(vault.asset() == route.loanToken);
        _require(vault.liquidityAdapter() == route.adapter);
        _require(vault.isAdapter(route.adapter));

        bytes memory data = vault.liquidityData();
        _require(data.length == 160);
        dataHash = keccak256(data);
        MarketParams memory liquidityMarket = abi.decode(data, (MarketParams));
        IMarketV1AdapterV2 adapter = IMarketV1AdapterV2(route.adapter);
        _require(adapter.parentVault() == route.vault);
        _require(adapter.asset() == route.loanToken);
        _require(adapter.morpho() == route.morpho);
        _require(liquidityMarket.loanToken == route.loanToken);
        _require(liquidityMarket.irm == adapter.adaptiveCurveIrm());
        _require(_manifestIncludesLiquidityData(json, route.adapter, dataHash));
    }

    function _manifestIncludesLiquidityData(string memory json, address adapter, bytes32 dataHash)
        internal
        view
        returns (bool)
    {
        uint256 i;
        string memory prefix = ".vault.downstreamAllocations[0]";
        while (vm.keyExistsJson(json, prefix)) {
            if (
                json.readAddress(string.concat(prefix, ".adapter")) == adapter
                    && json.readBytes32(string.concat(prefix, ".marketId")) == dataHash
                    && _same(json.readString(string.concat(prefix, ".liquidityRole")), "default")
            ) return true;
            prefix = string.concat(".vault.downstreamAllocations[", Strings.toString(++i), "]");
        }
        return false;
    }

    function _verifiedCode(address target, bytes32 expectedCodeHash) internal view {
        _require(target != address(0) && expectedCodeHash != bytes32(0));
        _require(target.code.length != 0 && target.codehash == expectedCodeHash);
    }

    function _manifestUint(string memory json, string memory key) internal view returns (uint256) {
        try this.readManifestUint(json, key) returns (uint256 value) {
            return value;
        } catch {
            try this.readManifestString(json, key) returns (string memory decimal) {
                try this.parseManifestUint(decimal) returns (uint256 value) {
                    return value;
                } catch {
                    revert ManifestRejected();
                }
            } catch {
                revert ManifestRejected();
            }
        }
    }

    function readManifestUint(string memory json, string memory key) external pure returns (uint256) {
        return json.readUint(key);
    }

    function readManifestString(string memory json, string memory key) external pure returns (string memory) {
        return json.readString(key);
    }

    function parseManifestUint(string memory decimal) external pure returns (uint256) {
        return vm.parseUint(decimal);
    }

    function _policy(DeploymentParameters memory parameters, ManifestRoute memory route)
        internal
        pure
        returns (CrestAccount.PolicyConfig memory)
    {
        return CrestAccount.PolicyConfig({
            market: route.market,
            yieldVault: route.vault,
            maxCollateralAssets: parameters.maxCollateralAssets,
            debtCeilingAssets: parameters.debtCeilingAssets,
            maxStrategyAssets: parameters.maxStrategyAssets,
            reserveFloorAssets: parameters.reserveFloorAssets,
            strategyFloorAssets: parameters.strategyFloorAssets,
            maxRepayPerActionAssets: parameters.maxRepayPerActionAssets,
            lowerLtvWad: parameters.lowerLtvWad,
            targetLtvWad: parameters.targetLtvWad,
            upperLtvWad: parameters.upperLtvWad,
            criticalLtvWad: parameters.criticalLtvWad,
            guardian: parameters.guardian
        });
    }


    function _rpcQuantity(uint256 value) internal pure returns (string memory) {
        bytes memory full = bytes(Strings.toHexString(value));
        uint256 start = 2;
        while (start + 1 < full.length && full[start] == bytes1("0")) ++start;
        bytes memory quantity = new bytes(full.length - start + 2);
        quantity[0] = "0";
        quantity[1] = "x";
        for (uint256 i = start; i < full.length; ++i) {
            quantity[i - start + 2] = full[i];
        }
        return string(quantity);
    }
    function _same(string memory left, string memory right) internal pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }

    function _require(bool condition) internal pure {
        if (!condition) revert ManifestRejected();
    }
}
