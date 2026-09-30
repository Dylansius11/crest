import { getAddress } from "viem";
import type { PublicClient } from "viem";

import { onchainAt, readCrestAccount, readFeed, readMarketOraclePrice, ROBINHOOD_CHAIN_ID } from "@crest/chain";
import type { PinnedBlock } from "@crest/chain";
import type { DeploymentManifest } from "@crest/contracts/manifest";
import { observe } from "@crest/domain";
import type { BlockRef, Observation } from "@crest/domain";
import { morphoRouteOf, readMarket, readPosition } from "@crest/morpho";
import type { PositionSnapshot } from "@crest/morpho";
import type { CompiledPolicy } from "@crest/policy";
import { policyHashOf } from "@crest/policy";
import { fetchMarketBorrowApy, fetchMarketIncentives, fetchVaultIncentives, fetchVaultNativeApy, vaultFees } from "@crest/rates";
import { assessLifecycle, fetchCorporateActions, fetchQuote, fetchStockTokenAsset, readStockToken } from "@crest/robinhood";
import type { StockTokenQuote } from "@crest/robinhood";
import type { RiskInput } from "@crest/risk";
import { readVault, readVaultPosition, simulateWithdrawal, vaultRouteOf } from "@crest/vault";
import type { VaultPosition } from "@crest/vault";

/** Select a named block behind the configured confirmation depth; a pending or wrong-chain horizon never passes. */
export async function pinConfirmedBlock(
  client: PublicClient, confirmationDepth: number, nowSeconds: bigint, maxHeadLagSeconds: bigint,
): Promise<Observation<PinnedBlock>> {
  if (!Number.isSafeInteger(confirmationDepth) || confirmationDepth < 0) throw new Error("invalid confirmation depth");
  const chainId = await client.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`expected chain ${ROBINHOOD_CHAIN_ID}, received ${chainId}`);
  const latest = await client.getBlock({ blockTag: "latest" });
  if (latest.number === null || latest.hash === null || latest.number < BigInt(confirmationDepth)) throw new Error("confirmation depth exceeds current chain head");
  const confirmed = await client.getBlock({ blockNumber: latest.number - BigInt(confirmationDepth) });
  if (confirmed.number === null || confirmed.hash === null || confirmed.number !== latest.number - BigInt(confirmationDepth)) throw new Error("confirmed block missing or inconsistent");
  const block: BlockRef = { number: confirmed.number, hash: confirmed.hash, timestamp: confirmed.timestamp };
  const headLagSeconds = nowSeconds > latest.timestamp ? nowSeconds - latest.timestamp : 0n;
  return observe({ block, headLagSeconds }, onchainAt(block), headLagSeconds > maxHeadLagSeconds ? ["head_lag"] : []);
}

/** Build the exact risk input from one finalized block and separately timestamped advisory data. */
export async function collectRiskInput(
  client: PublicClient,
  manifest: DeploymentManifest,
  compiled: CompiledPolicy,
  nonce: bigint,
  head: Observation<PinnedBlock>,
  strategyCostBasisAssets: bigint | null,
  scenarios: RiskInput["scenarios"],
  now: () => Date = () => new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<RiskInput> {
  if (head.value === null) throw new Error("confirmed block unavailable");
  const block = head.value.block;
  const route = morphoRouteOf(manifest);
  const vaultRoute = vaultRouteOf(manifest);
  const account = compiled.route.account;
  const reference = { headBlock: block.number, maxIndexLagBlocks: BigInt(compiled.policy.freshness.maxIndexLagBlocks) };
  const token = { chainId: manifest.network.chainId, address: route.params.collateralToken };
  const asset = await fetchStockTokenAsset(fetchFn, process.env.ROBINHOOD_API_BASE_URL ?? "https://api.robinhood.com/rhj", token, { now });
  const collateralFeedAddress = manifest.contracts.collateralFeed?.address;
  const loanFeedAddress = manifest.contracts.loanFeed?.address;
  if (!collateralFeedAddress || !loanFeedAddress) throw new Error("reviewed manifest has no feed addresses");
  const apiBase = process.env.ROBINHOOD_API_BASE_URL ?? "https://api.robinhood.com/rhj";
  const [market, vault, accountRead, marketPrice, collateralFeed, loanFeed, stockToken, borrow, vaultRate, vaultIncentives, marketIncentives, quote, actions] = await Promise.all([
    readMarket(client, block, route),
    readVault(client, block, vaultRoute),
    readCrestAccount(client, block, account, route.params.loanToken),
    readMarketOraclePrice(client, block, route.params.oracle),
    readFeed(client, block, getAddress(collateralFeedAddress), BigInt(compiled.policy.freshness.maxFeedAgeSeconds)),
    readFeed(client, block, getAddress(loanFeedAddress), BigInt(compiled.policy.freshness.maxFeedAgeSeconds)),
    readStockToken(client, block, route.params.collateralToken),
    fetchMarketBorrowApy(fetchFn, { chainId: manifest.network.chainId, marketId: route.marketId }, "24h", { now, reference }),
    fetchVaultNativeApy(fetchFn, { chainId: manifest.network.chainId, vault: vaultRoute.vault }, "one_day", { now, reference }),
    fetchVaultIncentives(fetchFn, { chainId: manifest.network.chainId, vault: vaultRoute.vault }, { now }),
    fetchMarketIncentives(fetchFn, { chainId: manifest.network.chainId, marketId: route.marketId }, { now }),
    asset.value === null ? Promise.resolve(observe<StockTokenQuote>(null, asset.provenance, asset.reasons)) : fetchQuote(fetchFn, apiBase, asset.value.symbol, token, { now }),
    fetchCorporateActions(fetchFn, apiBase, token, { now }),
  ]);
  const mismatch = accountRead.value !== null &&
    (accountRead.value.policy.marketId.toLowerCase() !== route.marketId.toLowerCase() ||
      accountRead.value.policy.yieldVault.toLowerCase() !== vaultRoute.vault.toLowerCase() ||
      policyHashOf(accountRead.value.policy) !== compiled.policyHash ||
      accountRead.value.policyNonce !== nonce);
  const accountObservation = mismatch ? observe(accountRead.value, accountRead.provenance, [...accountRead.reasons, "conflict"]) : accountRead;
  const position = market.value === null
    ? observe<PositionSnapshot>(null, onchainAt(block), market.reasons)
    : await readPosition(client, block, route, market.value, account);
  const strategy = await readVaultPosition(client, block, vaultRoute, vault, account);
  // The withdrawal simulation only tightens the computed liquidity bound. A quote is never proof of an exit.
  let strategyObservation: Observation<VaultPosition> = strategy;
  if (strategy.value !== null && strategy.value.availableAssets > 0n) {
    const withdrawal = await simulateWithdrawal(client, block, vaultRoute, strategy, strategy.value.availableAssets);
    if (withdrawal.status !== "normal" || withdrawal.value?.simulatedShares === null) {
      strategyObservation = observe({ ...strategy.value, availableAssets: 0n }, strategy.provenance, [...strategy.reasons, "withdrawal_constrained"]);
    }
  }
  const lifecycle = assessLifecycle({ token: stockToken, asset, quote, actions }, {
    now,
    assetMaxAgeSeconds: Number(compiled.policy.freshness.maxAssetAgeSeconds),
    quoteMaxAgeSeconds: Number(compiled.policy.freshness.maxQuoteAgeSeconds),
    actionsMaxAgeSeconds: Number(compiled.policy.freshness.maxCorporateActionsAgeSeconds),
  });
  return {
    policy: { compiled, nonce }, head, account: accountObservation, market, position,
    oracle: { marketPrice, collateralFeed, loanFeed }, vault, strategy: strategyObservation,
    rates: { borrow, vault: vaultRate, fees: vaultFees(vault), vaultIncentives, marketIncentives },
    lifecycle, strategyCostBasisAssets, scenarios,
  };
}
