import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getAddress } from "viem";
import type { Address, Hex } from "viem";

import { onchainAt } from "@crest/chain";
import type { FeedRound, PinnedBlock } from "@crest/chain";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { observe, parseDecimalUnits } from "@crest/domain";
import type { BlockRef, Observation, Provenance } from "@crest/domain";
import type { MarketSnapshot, PositionSnapshot } from "@crest/morpho";
import { compilePolicy, routeContextOf } from "@crest/policy";
import type { CompiledPolicy } from "@crest/policy";
import type { Incentive, RateValue, VaultFees } from "@crest/rates";
import type { LifecycleAssessment, StockTokenState } from "@crest/robinhood";
import type { VaultPosition, VaultSnapshot } from "@crest/vault";

import { parseScenarioSet } from "./scenarios.ts";
import type { AccountState, RiskInput } from "./input.ts";

/**
 * Test inputs for the pure risk engine.
 *
 * Addresses, market and vault parameters, and the vault's caps and liquidity come from the reviewed manifest.
 * Prices default to an exact synthetic 300 USDG per AAPL (feed and oracle agree, multiplier 1.0) so every
 * policy threshold lands on an exact integer debt. Rates default to the recorded 2026-09-23 Morpho values.
 */

const manifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));
export const scenarioSet = parseScenarioSet(JSON.parse(readFileSync(fileURLToPath(new URL("../../../config/scenarios.v2.json", import.meta.url)), "utf8")));

export const ACCOUNT = getAddress(`0x${"a1".repeat(20)}`);
export const OWNER = getAddress(`0x${"b2".repeat(20)}`);
export const GUARDIAN = getAddress(`0x${"c3".repeat(20)}`);
export const route = routeContextOf(manifest, { account: ACCOUNT, owner: OWNER });

// 2026-09-21T14:13:20Z. The pin's wall clock is two seconds later; HTTP responses arrived twenty seconds before it.
export const BLOCK: BlockRef = { number: 70_226_651n, hash: `0x${"ab".repeat(32)}`, timestamp: 1_790_000_000n };
export const at: Provenance = onchainAt(BLOCK);
const http: Provenance = { kind: "http", url: "https://api.morpho.org", fetchedAt: "2026-09-21T14:13:02Z", generatedAt: null, expiresAt: null, indexedBlock: 70_226_600n };

export const baseDraft = {
  schemaVersion: 2,
  intents: [
    { asset: route.market.collateralToken, intent: { kind: "PROTECT_AND_BORROW", marketId: route.marketId } },
    { asset: route.market.loanToken, intent: { kind: "EARN_STABLE", vaultId: `${route.chainId}:${route.vault}` } },
  ],
  maxCollateralAssets: "10000000000000000000",
  debtCeilingAssets: "1500000000",
  maxStrategyAssets: "1500000000",
  reserveFloorAssets: "50000000",
  strategyFloorAssets: "0",
  maxRepayPerActionAssets: "500000000",
  lowerLtvWad: "300000000000000000",
  targetLtvWad: "350000000000000000",
  upperLtvWad: "420000000000000000",
  criticalLtvWad: "500000000000000000",
  minimumNetSpreadBps: "100",
  maxOracleDivergenceBps: "100",
  harvestThresholdAssets: "10000000",
  triggers: { freezeOnOracleDegraded: true, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true },
  guardian: GUARDIAN,
};

export function policyWith(overrides: Record<string, unknown> = {}): CompiledPolicy {
  const result = compilePolicy({ ...baseDraft, ...overrides }, route);
  if (!result.ok) throw new Error(result.issues.join("; "));
  return result.policy;
}

export interface FixtureOptions {
  policy?: CompiledPolicy;
  collateralAssets?: bigint;
  debtAssets?: bigint;
  /** Morpho oracle price, 1e24-scaled for AAPL (18 decimals) in USDG (6 decimals). */
  oraclePrice?: bigint;
  collateralAnswer?: bigint;
  loanAnswer?: bigint;
  multiplierWad?: bigint;
  idleReserveAssets?: bigint;
  frozen?: boolean;
  strategyQuotedAssets?: bigint;
  strategyAvailableAssets?: bigint;
  costBasisAssets?: bigint | null;
  borrowApy?: string;
  vaultApy?: string;
}

function feed(address: Address, answer: bigint): Observation<FeedRound> {
  return observe({ feed: address, roundId: 1n, answer, decimals: 8, updatedAt: BLOCK.timestamp - 600n, ageSeconds: 600n }, at);
}

function rate(kind: RateValue["kind"], decimal: string): Observation<RateValue> {
  return observe<RateValue>({ kind, value: parseDecimalUnits(decimal, 18), scale: 10n ** 18n, convention: "apy-compounded", window: "P1D" }, http);
}

function vaultSnapshot(): VaultSnapshot {
  const cap = (id: string, allocation: bigint, absoluteCap: bigint) => ({ id: `0x${id.repeat(64)}` as Hex, allocation, absoluteCap, relativeCapWad: 10n ** 18n });
  return {
    vault: route.vault,
    asset: route.market.loanToken,
    totalAssets: 466_456_605_203_511n,
    totalSupply: 463_113_092_195_993_201_592_181_498n,
    sharePriceRay: 1_007_219_646_915_321_488_459_496_036n,
    fees: { performanceFeeWad: 0n, managementFeePerSecondWad: 0n },
    gates: { receiveShares: `0x${"0".repeat(40)}`, sendShares: `0x${"0".repeat(40)}`, receiveAssets: `0x${"0".repeat(40)}`, sendAssets: `0x${"0".repeat(40)}` },
    liquidityAdapter: getAddress(manifest.vault.governance.liquidityAdapter),
    liquidityMarketId: "0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6",
    caps: {
      adapter: cap("1", 466_456_400_807_229n, 1_000_000_000_000_000_000_000n),
      collateral: cap("2", 304_065_430_947_522n, 1_000_000_000_000_000n),
      market: cap("3", 304_065_430_947_522n, 1_000_000_000_000_000n),
    },
    idleAssets: 0n,
    adapterLiquidityAssets: 29_411_438_793_263n,
    capacityAssets: 29_411_438_793_263n,
  };
}

function lifecycle(multiplierWad: bigint): LifecycleAssessment {
  const token: StockTokenState = { uid: `0x${"c2".repeat(32)}`, uiMultiplierWad: multiplierWad, newUIMultiplierWad: multiplierWad, effectiveAt: 0n, oraclePaused: false, decimals: 18 };
  return {
    status: "normal",
    reasons: [],
    multiplierWad,
    inputs: {
      token: observe(token, at),
      asset: observe({ uid: token.uid, symbol: "AAPL", currentMultiplierWad: multiplierWad, pendingMultiplierWad: null, pendingEffectiveAt: null, status: "ASSET_STATUS_ACTIVE" as const }, http),
      quote: observe({ symbol: "AAPL", bid: "300.00", ask: "300.10", currency: "USD", isTradingHalt: false }, http),
      actions: observe([], http),
    },
  };
}

export function fixture(options: FixtureOptions = {}): RiskInput {
  const policy = options.policy ?? policyWith();
  const collateralAssets = options.collateralAssets ?? 10n * 10n ** 18n;
  const debtAssets = options.debtAssets ?? 1_000_000_000n;
  const strategyQuotedAssets = options.strategyQuotedAssets ?? 1_000_000_000n;
  const market: MarketSnapshot = {
    id: route.marketId,
    params: route.market,
    stored: { totalSupplyAssets: 239_020_403_890n, totalSupplyShares: 238_805_362_585_313_912n, totalBorrowAssets: 222_298_156_026n, totalBorrowShares: 222_073_571_953_179_044n, lastUpdate: BLOCK.timestamp, fee: 0n },
    accrued: { totalSupplyAssets: 239_020_403_890n, totalSupplyShares: 238_805_362_585_313_912n, totalBorrowAssets: 222_298_156_026n, totalBorrowShares: 222_073_571_953_179_044n, lastUpdate: BLOCK.timestamp, fee: 0n },
    accrualBorrowRatePerSecondWad: 0n,
    instantBorrowRatePerSecondWad: 0n,
    liquidityAssets: 238_958_227_292n,
  };
  const position: PositionSnapshot = { account: ACCOUNT, supplyShares: 0n, borrowShares: debtAssets * 10n ** 6n, collateralAssets, debtAssets };
  const account: AccountState = { account: ACCOUNT, borrowingFrozen: options.frozen ?? false, policyNonce: 1n, idleReserveAssets: options.idleReserveAssets ?? 60_000_000n };
  const strategy: VaultPosition = {
    account: ACCOUNT,
    shares: strategyQuotedAssets * 10n ** 12n,
    quotedAssets: strategyQuotedAssets,
    availableAssets: options.strategyAvailableAssets ?? strategyQuotedAssets,
  };
  const head: PinnedBlock = { block: BLOCK, headLagSeconds: 2n };
  return {
    policy: { compiled: policy, nonce: 1n },
    head: observe(head, at),
    account: observe(account, at),
    market: observe(market, at),
    position: observe(position, at),
    oracle: {
      marketPrice: observe(options.oraclePrice ?? 300n * 10n ** 24n, at),
      collateralFeed: feed(route.feeds.collateral, options.collateralAnswer ?? 30_000_000_000n),
      loanFeed: feed(route.feeds.loan, options.loanAnswer ?? 100_000_000n),
    },
    vault: observe(vaultSnapshot(), at),
    strategy: observe(strategy, at),
    rates: {
      borrow: rate("market_borrow", options.borrowApy ?? "0.0057406736830905025"),
      vault: rate("vault_native", options.vaultApy ?? "0.039987695710272775"),
      fees: observe<VaultFees>({ performanceFeeWad: 0n, managementFeeAprWad: 0n }, at),
      vaultIncentives: observe<Incentive[]>([], http),
      marketIncentives: observe<Incentive[]>([], http),
    },
    lifecycle: lifecycle(options.multiplierWad ?? 10n ** 18n),
    strategyCostBasisAssets: options.costBasisAssets === undefined ? 1_000_000_000n : options.costBasisAssets,
    scenarios: scenarioSet,
  };
}
