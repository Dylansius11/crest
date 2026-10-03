import { and, eq } from "drizzle-orm";

import {
  accountSnapshots, marketSnapshots, positionSnapshots, rateObservations, strategyPositionSnapshots, vaultSnapshots,
} from "@crest/db";
import type { createDatabase } from "@crest/db";
import { canonicalJson } from "@crest/domain";
import type { RiskInput } from "@crest/risk";

type Database = ReturnType<typeof createDatabase>["db"];
type Refs = {
  accountSnapshotId: string | null; positionSnapshotId: string | null; strategyPositionSnapshotId: string | null;
  marketSnapshotId: string | null; vaultSnapshotId: string | null;
};

const binary = (hex: string) => Buffer.from(hex.slice(2), "hex");
const atBlock = (input: RiskInput) => {
  if (input.head.value === null) throw new Error("cannot persist observations without a named block");
  const { block } = input.head.value;
  return { blockNumber: block.number, blockHash: binary(block.hash), blockTime: new Date(Number(block.timestamp) * 1000), canonical: true, observedAt: new Date(), providerKey: "robinhood-rpc" };
};

/** Persist only observed facts; null inputs remain null rather than turning unknown into zero. */
export async function persistObservations(
  db: Database, input: RiskInput, identities: { accountId: string; marketId: Uint8Array; vaultId: string },
  strategyActionableAssets: bigint,
): Promise<Refs> {
  const stamp = atBlock(input);
  const policy = input.account.value?.policy;
  const { accountId, marketId, vaultId } = identities;
  let marketSnapshotId: string | null = null;
  if (input.market.value !== null) {
    const value = input.market.value;
    const [inserted] = await db.insert(marketSnapshots).values({
      marketId, totalSupplyAssets: value.accrued.totalSupplyAssets, totalSupplyShares: value.accrued.totalSupplyShares,
      totalBorrowAssets: value.accrued.totalBorrowAssets, totalBorrowShares: value.accrued.totalBorrowShares,
      availableLoanAssets: value.liquidityAssets,
      borrowRateValue: value.instantBorrowRatePerSecondWad, borrowRateScale: 10n ** 18n,
      oracleValue: input.oracle.marketPrice.value, oracleScale: 10n ** 36n,
      oracleStatus: input.oracle.marketPrice.status, sequencerStatus: input.head.status,
      routeStatus: input.market.status,
      reasonCodes: [...input.market.reasons, ...input.oracle.marketPrice.reasons].filter((reason, index, all) => all.indexOf(reason) === index),
      ...stamp,
    }).onConflictDoNothing().returning({ id: marketSnapshots.id });
    if (inserted) marketSnapshotId = inserted.id;
    else {
      const [prior] = await db.select({
        id: marketSnapshots.id,
        totalSupplyAssets: marketSnapshots.totalSupplyAssets,
        totalSupplyShares: marketSnapshots.totalSupplyShares,
        totalBorrowAssets: marketSnapshots.totalBorrowAssets,
        totalBorrowShares: marketSnapshots.totalBorrowShares,
        availableLoanAssets: marketSnapshots.availableLoanAssets,
        borrowRateValue: marketSnapshots.borrowRateValue,
        oracleValue: marketSnapshots.oracleValue,
      }).from(marketSnapshots).where(and(eq(marketSnapshots.marketId, marketId), eq(marketSnapshots.blockHash, stamp.blockHash)));
      if (!prior || prior.totalSupplyAssets !== value.accrued.totalSupplyAssets ||
        prior.totalSupplyShares !== value.accrued.totalSupplyShares ||
        prior.totalBorrowAssets !== value.accrued.totalBorrowAssets ||
        prior.totalBorrowShares !== value.accrued.totalBorrowShares ||
        prior.availableLoanAssets !== value.liquidityAssets ||
        prior.borrowRateValue !== value.instantBorrowRatePerSecondWad ||
        prior.oracleValue !== input.oracle.marketPrice.value) {
        throw new Error("market snapshot changed at the same block");
      }
      marketSnapshotId = prior.id;
    }
  }

  let vaultSnapshotId: string | null = null;
  if (input.vault.value !== null) {
    const value = input.vault.value;
    const [inserted] = await db.insert(vaultSnapshots).values({
      vaultDeploymentId: vaultId, totalAssets: value.totalAssets, totalSupplyShares: value.totalSupply,
      maxDepositAssets: null, maxWithdrawAssets: null, previewRedeemAssets: input.strategy.value?.quotedAssets ?? null,
      pauseStatus: input.vault.status, downstreamJson: JSON.parse(canonicalJson({ caps: value.caps, liquidityAdapter: value.liquidityAdapter, liquidityMarketId: value.liquidityMarketId })),
      reasonCodes: [...input.vault.reasons], ...stamp,
    }).onConflictDoNothing().returning({ id: vaultSnapshots.id });
    if (inserted) vaultSnapshotId = inserted.id;
    else {
      const [prior] = await db.select({
        id: vaultSnapshots.id, totalAssets: vaultSnapshots.totalAssets,
        totalSupplyShares: vaultSnapshots.totalSupplyShares, previewRedeemAssets: vaultSnapshots.previewRedeemAssets,
      }).from(vaultSnapshots).where(and(eq(vaultSnapshots.vaultDeploymentId, vaultId), eq(vaultSnapshots.blockHash, stamp.blockHash)));
      if (!prior || prior.totalAssets !== value.totalAssets || prior.totalSupplyShares !== value.totalSupply ||
        prior.previewRedeemAssets !== (input.strategy.value?.quotedAssets ?? null)) {
        throw new Error("vault snapshot changed at the same block");
      }
      vaultSnapshotId = prior.id;
    }
  }

  let accountSnapshotId: string | null = null;
  if (input.account.value !== null && policy !== undefined) {
    const [inserted] = await db.insert(accountSnapshots).values({
      crestAccountId: accountId, ownerAddress: binary(policy.owner), guardianAddress: binary(policy.guardian),
      marketId, vaultDeploymentId: vaultId,
      maxCollateralAssets: policy.maxCollateralAssets, debtCeilingAssets: policy.debtCeilingAssets,
      maxStrategyAssets: policy.maxStrategyAssets, reserveFloorAssets: policy.reserveFloorAssets,
      strategyFloorAssets: policy.strategyFloorAssets, maxRepayPerActionAssets: policy.maxRepayPerActionAssets,
      lowerLtvWad: policy.lowerLtvWad, targetLtvWad: policy.targetLtvWad,
      upperLtvWad: policy.upperLtvWad, criticalLtvWad: policy.criticalLtvWad,
      borrowingFrozen: input.account.value.borrowingFrozen, policyNonce: input.account.value.policyNonce,
      loanTokenBalance: input.account.value.idleReserveAssets,
      collateralTokenBalance: null, vaultShareBalance: input.strategy.value?.shares ?? null,
      ...stamp,
    }).onConflictDoNothing().returning({ id: accountSnapshots.id });
    if (inserted) accountSnapshotId = inserted.id;
    else {
      const [prior] = await db.select({
        id: accountSnapshots.id, borrowingFrozen: accountSnapshots.borrowingFrozen,
        policyNonce: accountSnapshots.policyNonce, loanTokenBalance: accountSnapshots.loanTokenBalance,
        vaultShareBalance: accountSnapshots.vaultShareBalance,
        ownerAddress: accountSnapshots.ownerAddress, guardianAddress: accountSnapshots.guardianAddress,
        maxCollateralAssets: accountSnapshots.maxCollateralAssets, debtCeilingAssets: accountSnapshots.debtCeilingAssets,
        maxStrategyAssets: accountSnapshots.maxStrategyAssets, reserveFloorAssets: accountSnapshots.reserveFloorAssets,
        strategyFloorAssets: accountSnapshots.strategyFloorAssets, maxRepayPerActionAssets: accountSnapshots.maxRepayPerActionAssets,
      }).from(accountSnapshots).where(and(eq(accountSnapshots.crestAccountId, accountId), eq(accountSnapshots.blockHash, stamp.blockHash)));
      if (!prior || prior.borrowingFrozen !== input.account.value.borrowingFrozen ||
        prior.policyNonce !== input.account.value.policyNonce || prior.loanTokenBalance !== input.account.value.idleReserveAssets ||
        prior.vaultShareBalance !== (input.strategy.value?.shares ?? null) ||
        !Buffer.from(prior.ownerAddress).equals(binary(policy.owner)) ||
        !Buffer.from(prior.guardianAddress).equals(binary(policy.guardian)) ||
        prior.maxCollateralAssets !== policy.maxCollateralAssets || prior.debtCeilingAssets !== policy.debtCeilingAssets ||
        prior.maxStrategyAssets !== policy.maxStrategyAssets || prior.reserveFloorAssets !== policy.reserveFloorAssets ||
        prior.strategyFloorAssets !== policy.strategyFloorAssets || prior.maxRepayPerActionAssets !== policy.maxRepayPerActionAssets) {
        throw new Error("account snapshot changed at the same block");
      }
      accountSnapshotId = prior.id;
    }
  }

  let positionSnapshotId: string | null = null;
  if (input.position.value !== null) {
    const value = input.position.value;
    const price = input.oracle.marketPrice.value;
    const collateralValue = price === null ? null : value.collateralAssets * price / 10n ** 36n;
    const debt = value.debtAssets;
    const [inserted] = await db.insert(positionSnapshots).values({
      crestAccountId: accountId, marketId, borrowShares: value.borrowShares, borrowAssetsUp: debt,
      collateralAssets: value.collateralAssets, collateralValue,
      ltvWad: debt === 0n || collateralValue === null || collateralValue === 0n ? null : (debt * 10n ** 18n + collateralValue - 1n) / collateralValue,
      morphoHealthWad: debt === 0n || collateralValue === null ? null : ((collateralValue * input.policy.compiled.route.market.lltv / 10n ** 18n) * 10n ** 18n) / debt,
      ...stamp,
    }).onConflictDoNothing().returning({ id: positionSnapshots.id });
    if (inserted) positionSnapshotId = inserted.id;
    else {
      const [prior] = await db.select({
        id: positionSnapshots.id, borrowShares: positionSnapshots.borrowShares,
        borrowAssetsUp: positionSnapshots.borrowAssetsUp, collateralAssets: positionSnapshots.collateralAssets,
        collateralValue: positionSnapshots.collateralValue, ltvWad: positionSnapshots.ltvWad,
        morphoHealthWad: positionSnapshots.morphoHealthWad,
      }).from(positionSnapshots).where(and(
        eq(positionSnapshots.crestAccountId, accountId), eq(positionSnapshots.marketId, marketId), eq(positionSnapshots.blockHash, stamp.blockHash),
      ));
      const ltvWad = debt === 0n || collateralValue === null || collateralValue === 0n ? null : (debt * 10n ** 18n + collateralValue - 1n) / collateralValue;
      const morphoHealthWad = debt === 0n || collateralValue === null ? null : ((collateralValue * input.policy.compiled.route.market.lltv / 10n ** 18n) * 10n ** 18n) / debt;
      if (!prior || prior.borrowShares !== value.borrowShares || prior.borrowAssetsUp !== debt ||
        prior.collateralAssets !== value.collateralAssets || prior.collateralValue !== collateralValue ||
        prior.ltvWad !== ltvWad || prior.morphoHealthWad !== morphoHealthWad) {
        throw new Error("position snapshot changed at the same block");
      }
      positionSnapshotId = prior.id;
    }
  }

  let strategyPositionSnapshotId: string | null = null;
  if (input.strategy.value !== null) {
    const value = input.strategy.value;
    const floor = input.policy.compiled.config.strategyFloorAssets;
    const [inserted] = await db.insert(strategyPositionSnapshots).values({
      crestAccountId: accountId, vaultDeploymentId: vaultId, shareBalance: value.shares,
      quotedAssets: value.quotedAssets, maxWithdrawableAssets: value.availableAssets,
      strategyFloorAssets: floor,
      actionableAssets: strategyActionableAssets,
      ...stamp,
    }).onConflictDoNothing().returning({ id: strategyPositionSnapshots.id });
    if (inserted) strategyPositionSnapshotId = inserted.id;
    else {
      const [prior] = await db.select({
        id: strategyPositionSnapshots.id, shareBalance: strategyPositionSnapshots.shareBalance,
        quotedAssets: strategyPositionSnapshots.quotedAssets,
        maxWithdrawableAssets: strategyPositionSnapshots.maxWithdrawableAssets,
        strategyFloorAssets: strategyPositionSnapshots.strategyFloorAssets,
        actionableAssets: strategyPositionSnapshots.actionableAssets,
      }).from(strategyPositionSnapshots).where(and(
        eq(strategyPositionSnapshots.crestAccountId, accountId), eq(strategyPositionSnapshots.vaultDeploymentId, vaultId), eq(strategyPositionSnapshots.blockHash, stamp.blockHash),
      ));
      if (!prior || prior.shareBalance !== value.shares || prior.quotedAssets !== value.quotedAssets ||
        prior.maxWithdrawableAssets !== value.availableAssets || prior.strategyFloorAssets !== floor ||
        prior.actionableAssets !== strategyActionableAssets) {
        throw new Error("strategy snapshot changed at the same block");
      }
      strategyPositionSnapshotId = prior.id;
    }
  }

  for (const [observation, subjectKind] of [[input.rates.borrow, "morpho_borrow"], [input.rates.vault, "vault_base"]] as const) {
    if (observation.value === null || observation.provenance.kind !== "http") continue;
    const source = observation.provenance;
    const [inserted] = await db.insert(rateObservations).values({
      subjectKind,
      ...(subjectKind === "morpho_borrow" ? { marketId } : { vaultDeploymentId: vaultId }),
      rateValue: observation.value.value, rateScale: observation.value.scale,
      periodKind: `${observation.value.convention}:${observation.value.window}`,
      grossOrNet: "unknown", sourceUrl: source.url,
      sourceGeneratedAt: source.generatedAt ? new Date(source.generatedAt) : null,
      fetchedAt: new Date(source.fetchedAt), expiresAt: new Date(source.expiresAt ?? source.fetchedAt),
      status: observation.status, reasonCodes: [...observation.reasons],
    }).onConflictDoNothing().returning({ id: rateObservations.id });
    if (!inserted) {
      const [prior] = await db.select({
        rateValue: rateObservations.rateValue, rateScale: rateObservations.rateScale,
        status: rateObservations.status, expiresAt: rateObservations.expiresAt,
      }).from(rateObservations).where(and(
        eq(rateObservations.subjectKind, subjectKind),
        subjectKind === "morpho_borrow" ? eq(rateObservations.marketId, marketId) : eq(rateObservations.vaultDeploymentId, vaultId),
        eq(rateObservations.sourceUrl, source.url),
        eq(rateObservations.fetchedAt, new Date(source.fetchedAt)),
        eq(rateObservations.periodKind, `${observation.value.convention}:${observation.value.window}`),
      ));
      if (!prior || prior.rateValue !== observation.value.value || prior.rateScale !== observation.value.scale ||
        prior.status !== observation.status || prior.expiresAt.getTime() !== Date.parse(source.expiresAt ?? source.fetchedAt)) {
        throw new Error("rate observation changed at the same provider timestamp");
      }
    }
  }
  return { accountSnapshotId, positionSnapshotId, strategyPositionSnapshotId, marketSnapshotId, vaultSnapshotId };
}
