"use client";

import { decodeFunctionData, parseAbi } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cell, Fact } from "@/components/ui/cell";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { compactAddress, decimal, percentFromWad } from "./format";
import { SandboxNotice } from "./sandbox-notice";
import type { RecordedPosition, TransactionEvidence, TransactionPhase } from "./types";

const PHASE: Record<TransactionPhase, { label: string; tone: "neutral" | "verified" | "warn" | "stop" | "degraded" }> = {
  idle: { label: "Nothing prepared", tone: "neutral" },
  blocked: { label: "Policy blocked", tone: "degraded" },
  simulating: { label: "Simulating", tone: "neutral" },
  "simulation-failed": { label: "Simulation failed", tone: "stop" },
  "signature-ready": { label: "Ready to sign", tone: "warn" },
  pending: { label: "Pending", tone: "warn" },
  confirmed: { label: "Confirmed", tone: "verified" },
  reverted: { label: "Reverted", tone: "stop" },
  "reconciliation-failed": { label: "Reconciliation failed", tone: "stop" },
};

const explorer = activeManifest.network.explorerUrl.replace(/\/$/, "");
const PREVIEW_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function supplyCollateral(uint256 assets)",
  "function borrowAndDeploy(uint256 assets, uint256 minVaultShares)",
  "function ownerRepay(uint256 assets)",
  "function withdrawStrategy(uint256 assets, address receiver, uint256 maxShares)",
  "function withdrawCollateral(uint256 assets, address receiver)",
  "function withdrawLoanToken(uint256 assets, address receiver)",
  "function unfreezeBorrowing()",
]);

const SUMMARY: Record<NonNullable<TransactionEvidence["action"]>, string> = {
  "approve-collateral": "Approve this account to use the stated collateral amount. Approval alone moves nothing.",
  "approve-loan": "Approve this account to use the stated USDG amount. Approval alone moves nothing.",
  configure: "Set the owner's limits and Custos permissions. Only this owner signature can change the rules.",
  supply: "Move stock tokens from your wallet into this account as Morpho collateral.",
  "borrow-and-deploy": "Create owner-approved USDG debt and deposit the borrowed USDG into the fixed vault.",
  "owner-repay": "Repay this account's Morpho debt from your wallet.",
  "withdraw-strategy": "Withdraw USDG from the fixed vault to your owner wallet.",
  "withdraw-collateral": "Withdraw stock-token collateral to your owner wallet, subject to Morpho limits.",
  "withdraw-reserve": "Withdraw idle USDG to your owner wallet, subject to your reserve floor.",
  unfreeze: "Allow new owner borrowing again. Unfreezing alone does not create debt.",
};

function actionPreview(transaction: TransactionEvidence) {
  if (!transaction.calldata) return null;
  try {
    return decodeFunctionData({ abi: PREVIEW_ABI, data: transaction.calldata });
  } catch {
    return null;
  }
}

export type TransactionPanelProps = {
  account: string | null;
  owner: string | null;
  position: RecordedPosition | null;
  transaction: TransactionEvidence;
  blockedReason: string | null;
  onSimulateConfiguration(): void;
  onSubmitPrepared(): void;
};

export function TransactionPanel({ account, owner, position, transaction, blockedReason, onSimulateConfiguration, onSubmitPrepared }: TransactionPanelProps) {
  const phase = PHASE[transaction.phase];
  const readyToSign = transaction.phase === "signature-ready";
  const configurationPrepared = transaction.action === "configure" && transaction.calldata !== undefined && transaction.phase === "idle";
  const decoded = actionPreview(transaction);
  const args = decoded?.args;
  const amount = args && typeof args[0] === "bigint" ? args[0] : args && typeof args[1] === "bigint" ? args[1] : null;
  const token = transaction.action === "approve-collateral" || transaction.action === "supply" || transaction.action === "withdraw-collateral" ? activeTokens.collateral : activeTokens.loan;
  const snapshot = position?.snapshot;
  const changesGuardian = transaction.action === "configure";

  return (
    <Cell id="owner-transaction" index="Owner transaction" meta={transaction.action?.replaceAll("-", " ") ?? "none"} className="border-0 bg-paper" tabIndex={-1} aria-labelledby="owner-transaction-title">
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="owner-transaction-title" className="type-display text-poster-md">Review and sign</p>
          <Badge tone={phase.tone}>{phase.label}</Badge>
        </div>
        <p className="text-base leading-relaxed">{transaction.action ? SUMMARY[transaction.action] : "No owner action is prepared."}</p>
        <p className="text-sm" role="status" aria-live="polite">{transaction.detail}</p>
        {blockedReason && (readyToSign || configurationPrepared) ? <p className="border-l-2 border-signal-degraded pl-3 text-sm" role="note">Locked: {blockedReason}</p> : null}
        <dl>
          <Fact label="Chain and environment">{activeManifest.network.name} {activeManifest.network.chainId} · {activeManifest.trust.level}</Fact>
          <Fact label="Crest Account">{account ?? "Not selected"}</Fact>
          <Fact label="Morpho">{activeManifest.contracts.morpho?.address ?? "Unavailable"}</Fact>
          <Fact label="Fixed vault">{activeManifest.vault.address}</Fact>
          <Fact label="Market route">{activeManifest.market.id}</Fact>
          <Fact label="Recipient contract">{transaction.recipient ?? "Not prepared"}</Fact>
          <Fact label="Selector">{transaction.selector ?? "Not prepared"}</Fact>
          <Fact label="Token and amount">{amount === null ? "Not specified for this action" : decimal(amount.toString(), token.decimals, token.symbol)}</Fact>
          <Fact label="Vault share bound">{decoded?.functionName === "borrowAndDeploy" && args ? `At least ${args[1]?.toString()} shares (50 bps below preview)` : decoded?.functionName === "withdrawStrategy" && args ? `At most ${args[2]?.toString()} shares (50 bps above preview)` : "Not applicable"}</Fact>
          <Fact label="Withdrawal receiver">{transaction.action?.startsWith("withdraw-") ? owner ?? "Owner wallet unavailable" : "No withdrawal"}</Fact>
          <Fact label="Current debt">{decimal(snapshot?.debtAssets, activeTokens.loan.decimals, activeTokens.loan.symbol)}</Fact>
          <Fact label="Resulting debt">Not available from simulation; verify the receipt and next snapshot.</Fact>
          <Fact label="Current LTV">{percentFromWad(snapshot?.ltvWad)}</Fact>
          <Fact label="Resulting LTV">Not available from simulation; onchain rules still apply.</Fact>
          <Fact label="Collateral cap">Not included in the recorded snapshot; enforced by the account onchain.</Fact>
          <Fact label="Debt ceiling">Not included in the recorded snapshot; enforced by the account onchain.</Fact>
          <Fact label="Reserve floor">{decimal(snapshot?.reserveFloorAssets, activeTokens.loan.decimals, activeTokens.loan.symbol)}</Fact>
          <Fact label="Vault floor">{decimal(snapshot?.strategyFloorAssets, activeTokens.loan.decimals, activeTokens.loan.symbol)}</Fact>
          <Fact label="Custos repayment cap">{decimal(snapshot?.maxRepayPerActionAssets, activeTokens.loan.decimals, activeTokens.loan.symbol)}</Fact>
          <Fact label="Guardian authority">{changesGuardian ? "May change if this policy transaction is mined" : "Unchanged"}</Fact>
          <Fact label="Estimated gas">{transaction.gas?.toString() ?? "Not simulated"}</Fact>
          <Fact label="Simulation block">{transaction.blockNumber?.toString() ?? "Not simulated"}</Fact>
          <Fact label="Transaction">{transaction.hash ? <a className="underline underline-offset-4" href={`${explorer}/tx/${transaction.hash}`} target="_blank" rel="noopener noreferrer">{compactAddress(transaction.hash)} ↗</a> : "Not submitted"}</Fact>
        </dl>
        {transaction.action === "configure" ? <p className="border border-signal-warn p-3 text-sm">Changing Guardian permissions, repayment limits, caps, or floors changes what Custos may do after this policy is mined. Review the exact policy before signing.</p> : null}
        {transaction.action === "unfreeze" ? <p className="border border-signal-warn p-3 text-sm">Unfreezing reopens owner borrowing. Only your wallet can create new debt.</p> : null}
        {activeManifest.trust.level === "sandbox" ? <>
          <p className="border-t border-ink pt-4 text-sm">This is a sandbox route. <a className="underline underline-offset-4" href="#review-disclosures" onClick={(event) => { event.preventDefault(); const disclosures = document.getElementById("review-disclosures"); if (disclosures instanceof HTMLDetailsElement) { disclosures.open = true; disclosures.scrollIntoView({ block: "nearest" }); } }}>Read every disclosure before signing.</a></p>
          <details id="review-disclosures" className="border border-ink"><summary className="min-h-11 cursor-pointer content-center px-3 text-sm">Sandbox disclosures</summary><SandboxNotice manifest={activeManifest} titleId="review-sandbox-title" /></details>
        </> : null}
        {configurationPrepared ? <Button type="button" variant="outline" className="w-full active:scale-[.97]" disabled={blockedReason !== null} onClick={onSimulateConfiguration}>Simulate configuration</Button> : null}
        {readyToSign ? <Button type="button" variant="flame" className="w-full active:scale-[.97]" disabled={blockedReason !== null} onClick={onSubmitPrepared}>Request owner signature</Button> : null}
        {transaction.calldata ? (
          <details className="border border-ink">
            <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm">Exact calldata and block hash</summary>
            <div className="grid gap-2 border-t border-ink p-3 font-mono text-xs break-all">
              <p>{transaction.calldata}</p>
              <p>Block hash: {transaction.blockHash ?? "Not simulated"}</p>
            </div>
          </details>
        ) : null}
      </div>
    </Cell>
  );
}
