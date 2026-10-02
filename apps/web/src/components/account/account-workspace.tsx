"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BaseError,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  parseEventLogs,
  parseUnits,
  slice,
} from "viem";
import type { Address, Hex } from "viem";

import { compilePolicy, policyStagingMessage, routeContextOf, toConfigurationCall } from "@crest/policy";

import { Button, ButtonLink } from "@/components/ui/button";
import { Cell } from "@/components/ui/cell";
import { borrowGate, borrowSignatureBlock } from "@/lib/borrow-gate";
import type { BorrowGate } from "@/lib/borrow-gate";
import { activeManifest, activeTokens } from "@/lib/manifest";
import type { RouteToken } from "@/lib/manifest";
import { isOwnerSigningEnabled } from "@/lib/transaction-route";
import { AccountEvidence } from "./account-evidence";
import { PositionSection } from "./position-section";
import { AccountOverview } from "./account-overview";
import { DeployPanel } from "./deploy-panel";
import { EntryPanel } from "./entry-panel";
import { ExitPanel } from "./exit-panel";
import { compactAddress, percentPointsToWad } from "./format";
import { InventoryTable } from "./inventory-table";
import { PolicyEditor } from "./policy-editor";
import type { PolicyFormValues } from "./policy-editor";
import { assertStagedPolicyResponse } from "./policy-stage";
import { SandboxNotice } from "./sandbox-notice";
import { TransactionPanel } from "./transaction-panel";
import { activeChain, freshHead, providerOf, publicClient, selectProvider, switchToActiveChain } from "./wallet-client";
import type { Eip1193Provider } from "./wallet-client";
import { WalletPicker } from "./wallet-picker";
import type { DiscoveredWallet } from "./wallet-discovery";
import type { ExitAction, LiveAccountState, RecordedAccount, RecordedPosition, RecordedRegistry, TransactionAction, TransactionEvidence, WalletState } from "./types";

const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const ACCOUNT_READ_ABI = parseAbi([
  "function owner() view returns (address)",
  "function policyNonce() view returns (uint64)",
  "function borrowingFrozen() view returns (bool)",
  "function currentDebtAssets() view returns (uint256)",
  "function idleReserveAssets() view returns (uint256)",
  "function strategyAssets() view returns (uint256)",
  "function maxWithdrawableStrategyAssets() view returns (uint256)",
]);
const ACCOUNT_ACTION_ABI = parseAbi([
  "function supplyCollateral(uint256 assets)",
  "function borrowAndDeploy(uint256 assets, uint256 minVaultShares)",
  "function ownerRepay(uint256 assets)",
  "function withdrawStrategy(uint256 assets, address receiver, uint256 maxShares)",
  "function withdrawCollateral(uint256 assets, address receiver)",
  "function withdrawLoanToken(uint256 assets, address receiver)",
  "function unfreezeBorrowing()",
]);
const ACCOUNT_EVENT_ABI = parseAbi([
  "event PolicyConfigured(uint64 indexed policyNonce, bytes32 indexed marketId, address indexed yieldVault, bytes32 policyHash)",
  "event CollateralSupplied(uint256 assets, uint256 resultingCollateral)",
  "event BorrowedAndDeployed(uint256 borrowedAssets, uint256 vaultShares, uint256 debtAfter, uint256 strategyAssetsAfter)",
  "event OwnerRepaid(uint256 repaidAssets, uint256 debtBefore, uint256 debtAfter)",
  "event StrategyWithdrawn(uint256 assets, uint256 shares, address indexed receiver)",
  "event CollateralWithdrawn(uint256 assets, address indexed receiver)",
  "event LoanTokenWithdrawn(uint256 assets, address indexed receiver)",
  "event BorrowingUnfrozen(address indexed owner, uint64 indexed policyNonce)",
]);
const VAULT_ABI = parseAbi([
  "function previewDeposit(uint256 assets) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
]);
const MORPHO_ABI = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

/** The canonical event each owner action must emit from the Crest Account; approvals are checked by allowance. */
const EXPECTED_EVENT: Record<TransactionAction, (typeof ACCOUNT_EVENT_ABI)[number]["name"] | null> = {
  "approve-collateral": null,
  "approve-loan": null,
  configure: "PolicyConfigured",
  supply: "CollateralSupplied",
  "borrow-and-deploy": "BorrowedAndDeployed",
  "owner-repay": "OwnerRepaid",
  "withdraw-strategy": "StrategyWithdrawn",
  "withdraw-collateral": "CollateralWithdrawn",
  "withdraw-reserve": "LoanTokenWithdrawn",
  unfreeze: "BorrowingUnfrozen",
};

/** Which lock governs a prepared action: exits and their approvals only ever reduce exposure. */
const EXIT_SIDE: Record<TransactionAction, boolean> = {
  "approve-collateral": false,
  "approve-loan": true,
  configure: false,
  supply: false,
  "borrow-and-deploy": false,
  "owner-repay": true,
  "withdraw-strategy": true,
  "withdraw-collateral": true,
  "withdraw-reserve": true,
  unfreeze: true,
};

/** Keeps the transaction panel in view; on a narrow screen it sits below the forms that prepare an action. */
function revealTransaction(): void {
  document.getElementById("owner-transaction")?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

/**
 * Vault share bounds keep a 50 bps margin around the simulated preview, so ordinary share-price movement between
 * simulation and inclusion does not revert, while a larger loss still does.
 */
const SHARE_MARGIN_BPS = 50n;

type PreparedAction = {
  action: TransactionAction;
  data: Hex;
  selector: Hex;
  detail: string;
  to: Address;
  policyHash?: Hex;
  expectedPolicyNonce?: bigint;
  allowance?: { token: Address; amount: bigint };
  /** Borrowed assets of a prepared borrow, rechecked against the live gate at signature time. */
  borrowAssets?: bigint;
};
type PreTransactionState = { policyNonce: bigint; debt: bigint; strategy: bigint };

const { collateral: collateralToken, loan: loanToken } = activeTokens;
const morphoEvidence = activeManifest.contracts.morpho;
if (!morphoEvidence) throw new Error(`${activeManifest.network.name} manifest is missing the Morpho core`);
const morphoAddress = getAddress(morphoEvidence.address);
const vaultAddress = getAddress(activeManifest.vault.address);
// The validator binds market.id to the derived market parameters, so it is a 32-byte hex id.
const marketId = activeManifest.market.id as Hex;

function withMargin(shares: bigint, direction: "floor" | "ceil"): bigint {
  return direction === "floor"
    ? (shares * (10_000n - SHARE_MARGIN_BPS)) / 10_000n
    : (shares * (10_000n + SHARE_MARGIN_BPS) + 9_999n) / 10_000n;
}

function emptyTransaction(detail = "No transaction prepared. Compilation and simulation are both required before a wallet signature."): TransactionEvidence {
  return { phase: "idle", action: null, detail };
}

function decimalOrThrow(value: string, decimals: number, label: string): bigint {
  if (value.trim().length === 0) throw new Error(`${label} is required`);
  return parseUnits(value.trim(), decimals);
}

/** viem's short message names the revert; its full message repeats the whole request. */
function errorText(error: unknown): string {
  if (error instanceof BaseError) return error.shortMessage;
  return error instanceof Error ? error.message : "unknown error";
}

export function AccountWorkspace() {
  const [wallet, setWallet] = useState<WalletState>({ kind: "disconnected" });
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<Eip1193Provider | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [registry, setRegistry] = useState<RecordedRegistry | null>(null);
  const [registryNotice, setRegistryNotice] = useState("Connect a wallet to request its recorded account registry.");
  const [inspectAddress, setInspectAddress] = useState("");
  const [inspectNotice, setInspectNotice] = useState("");
  const [selectedAccount, setSelectedAccount] = useState<RecordedAccount | null>(null);
  const [position, setPosition] = useState<RecordedPosition | null>(null);
  const [positionNotice, setPositionNotice] = useState("Select a recorded account to load recorded position evidence.");
  const [walletBalances, setWalletBalances] = useState<{ collateral: bigint | null; loan: bigint | null; block: bigint | null }>({ collateral: null, loan: null, block: null });
  const [assetIntents, setAssetIntents] = useState<{ collateral: "KEEP" | "PROTECT_AND_BORROW"; loan: "KEEP" | "EARN_STABLE" }>({ collateral: "KEEP", loan: "KEEP" });
  const [issues, setIssues] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [transaction, setTransaction] = useState<TransactionEvidence>(emptyTransaction());
  const [liveState, setLiveState] = useState<LiveAccountState | null>(null);
  const [liveNotice, setLiveNotice] = useState("Select a Crest Account to read its live onchain state.");
  const [degradedAcknowledged, setDegradedAcknowledged] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const preTransactionState = useRef<PreTransactionState | null>(null);
  const policyRequest = useRef(0);
  const liveRequest = useRef(0);

  const selectedAddress = selectedAccount !== null && isAddress(selectedAccount.address) ? getAddress(selectedAccount.address) : null;

  const refreshLiveState = useCallback(async (account: Address) => {
    const request = ++liveRequest.current;
    setLiveNotice("Reading live account state from the chain.");
    try {
      const blockNumber = await publicClient.getBlockNumber();
      const [frozen, debt, reserve, strategy, withdrawable, morphoPosition] = await Promise.allSettled([
        publicClient.readContract({ address: account, abi: ACCOUNT_READ_ABI, functionName: "borrowingFrozen", blockNumber }),
        publicClient.readContract({ address: account, abi: ACCOUNT_READ_ABI, functionName: "currentDebtAssets", blockNumber }),
        publicClient.readContract({ address: account, abi: ACCOUNT_READ_ABI, functionName: "idleReserveAssets", blockNumber }),
        publicClient.readContract({ address: account, abi: ACCOUNT_READ_ABI, functionName: "strategyAssets", blockNumber }),
        publicClient.readContract({ address: account, abi: ACCOUNT_READ_ABI, functionName: "maxWithdrawableStrategyAssets", blockNumber }),
        publicClient.readContract({ address: morphoAddress, abi: MORPHO_ABI, functionName: "position", args: [marketId, account], blockNumber }),
      ]);
      if (request !== liveRequest.current) return;
      setLiveState({
        blockNumber,
        frozen: frozen.status === "fulfilled" ? frozen.value : null,
        debtAssets: debt.status === "fulfilled" ? debt.value : null,
        reserveAssets: reserve.status === "fulfilled" ? reserve.value : null,
        strategyAssets: strategy.status === "fulfilled" ? strategy.value : null,
        withdrawableStrategyAssets: withdrawable.status === "fulfilled" ? withdrawable.value : null,
        collateralAssets: morphoPosition.status === "fulfilled" ? morphoPosition.value[2] : null,
      });
      const failed = [frozen, debt, reserve, strategy, withdrawable, morphoPosition].filter((result) => result.status === "rejected").length;
      setLiveNotice(failed === 0 ? `Read directly from the chain at block ${blockNumber}.` : `Read at block ${blockNumber}; ${failed} of 6 reads failed and show as unavailable.`);
    } catch (error) {
      if (request !== liveRequest.current) return;
      setLiveState(null);
      setLiveNotice(error instanceof Error ? `Live account read failed: ${error.message}` : "Live account read failed.");
    }
  }, []);

  useEffect(() => {
    policyRequest.current += 1;
    preTransactionState.current = null;
    setPrepared(null);
    setLiveState(null);
    setTransaction(selectedAddress ? emptyTransaction(`Account ${compactAddress(selectedAddress)} selected. Prepare an action; it is simulated before any signature is requested.`) : emptyTransaction());
    if (selectedAddress) void refreshLiveState(selectedAddress);
  }, [refreshLiveState, selectedAddress]);

  // Assessment freshness is judged against a ticking clock, so a page left open cannot keep a stale borrow gate.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // An acknowledgement covers one specific degraded assessment, never the next one.
  useEffect(() => {
    setDegradedAcknowledged(false);
  }, [position?.assessment?.createdAt, selectedAddress]);

  const changeIntent = useCallback((address: string, intent: "KEEP" | "PROTECT_AND_BORROW" | "EARN_STABLE") => {
    if (transaction.phase === "pending" || transaction.phase === "reconciliation-failed") return;
    if (address.toLowerCase() === collateralToken.address.toLowerCase() && (intent === "KEEP" || intent === "PROTECT_AND_BORROW")) {
      setAssetIntents((current) => ({ ...current, collateral: intent }));
    } else if (address.toLowerCase() === loanToken.address.toLowerCase() && (intent === "KEEP" || intent === "EARN_STABLE")) {
      setAssetIntents((current) => ({ ...current, loan: intent }));
    } else return;
    policyRequest.current += 1;
    setPrepared(null);
    setTransaction(emptyTransaction("Asset intent changed. Compile and simulate the exact owner action again."));
  }, [transaction.phase]);

  const refreshRegistry = useCallback(async (owner: Address) => {
    setRegistry(null);
    setSelectedAccount(null);
    setPosition(null);
    setRegistryNotice("Loading recorded account registry.");
    try {
      const response = await fetch(`/v1/accounts?owner=${encodeURIComponent(owner)}`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`recorded account service returned ${response.status}`);
      const result = await response.json() as RecordedRegistry;
      if (result.evidence !== "recorded" || !Array.isArray(result.accounts)) throw new Error("recorded account service returned an invalid evidence payload");
      setRegistry(result);
      const exact = result.accounts.filter((account) => account.chainId === String(activeManifest.network.chainId) && isAddress(account.address));
      const [first] = exact;
      setSelectedAccount(first ?? null);
      setRegistryNotice(first ? "Recorded account registry loaded. Select an account to inspect its evidence." : "No Crest Account is registered for this wallet. Simulate a deployment below, or register an existing deployment receipt.");
    } catch (error) {
      setRegistryNotice(error instanceof Error ? `${error.message}. Read-only account fallback remains available.` : "Recorded account service is unavailable. Read-only account fallback remains available.");
    }
  }, []);
  const refreshBalances = useCallback(async (owner: Address) => {
    try {
      const [block, collateral, loan] = await Promise.all([
        publicClient.getBlockNumber(),
        publicClient.readContract({ address: getAddress(collateralToken.address), abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }),
        publicClient.readContract({ address: getAddress(loanToken.address), abi: ERC20_ABI, functionName: "balanceOf", args: [owner] }),
      ]);
      setWalletBalances({ collateral, loan, block });
    } catch {
      setWalletBalances({ collateral: null, loan: null, block: null });
    }
  }, []);

  const hydrateWallet = useCallback(async (accounts: readonly string[], chainValue: string | number) => {
    const [first] = accounts;
    if (!first || !isAddress(first)) {
      setWallet({ kind: "disconnected" });
      return;
    }
    const address = getAddress(first);
    const chainId = typeof chainValue === "string" ? Number.parseInt(chainValue, 16) : chainValue;
    if (chainId !== activeManifest.network.chainId) {
      setWallet({ kind: "wrong-chain", address, chainId });
      return;
    }
    setWallet({ kind: "connected", address });
    void refreshRegistry(address);
    void refreshBalances(address);
  }, [refreshBalances, refreshRegistry]);

  useEffect(() => {
    const provider = activeProvider;
    if (!provider) return;
    const accountsChanged = (accounts: unknown) => {
      policyRequest.current += 1;
      if (Array.isArray(accounts) && accounts.every((item) => typeof item === "string")) void provider.request({ method: "eth_chainId" }).then((chainId) => hydrateWallet(accounts, chainId as string));
    };
    const chainChanged = (chainId: unknown) => {
      policyRequest.current += 1;
      if (typeof chainId === "string") void provider.request({ method: "eth_accounts" }).then((accounts) => hydrateWallet(accounts as string[], chainId));
    };
    const disconnected = () => setWallet({ kind: "disconnected" });
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [activeProvider, hydrateWallet]);

  useEffect(() => {
    if (!selectedAddress || position?.account.address.toLowerCase() === selectedAddress.toLowerCase()) return;
    let active = true;
    const loadPosition = async () => {
      setPosition(null);
      setPositionNotice("Loading recorded position evidence.");
      try {
        const response = await fetch(`/v1/accounts/${selectedAddress}/position`, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(response.status === 404 ? "Recorded account position was not found" : `recorded position service returned ${response.status}`);
        const result = await response.json() as RecordedPosition;
        if (result.evidence !== "recorded" || result.account.address.toLowerCase() !== selectedAddress.toLowerCase()) throw new Error("recorded position service returned an invalid evidence payload");
        if (active) {
          setPosition(result);
          setPositionNotice("Recorded position evidence loaded. It is not live chain state.");
        }
      } catch (error) {
        if (active) setPositionNotice(error instanceof Error ? `${error.message}. Transaction controls stay disabled.` : "Recorded position evidence is unavailable. Transaction controls stay disabled.");
      }
    };
    void loadPosition();
    return () => { active = false; };
  }, [selectedAddress]);

  const inspectRecordedAddress = useCallback(async () => {
    if (!isAddress(inspectAddress, { strict: true })) {
      setInspectNotice("Enter a valid 0x Crest Account address to read its recorded evidence.");
      return;
    }
    const address = getAddress(inspectAddress);
    setInspectNotice("Looking up the recorded account.");
    try {
      const response = await fetch(`/v1/accounts/${address}/position`, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(response.status === 404 ? "No recorded account exists at that address" : `Account service returned ${response.status}`);
      const result = await response.json() as RecordedPosition;
      if (result.evidence !== "recorded" || result.account.address.toLowerCase() !== address.toLowerCase() || result.account.chainId !== String(activeManifest.network.chainId)) throw new Error(`That account is not recorded on ${activeManifest.network.name} ${activeManifest.network.chainId}`);
      setPosition(result);
      setSelectedAccount(result.account);
      setPositionNotice("Recorded position evidence loaded. It is not live chain state.");
      setInspectNotice("Recorded account selected. A wallet is not needed to read it.");
    } catch (error) {
      setInspectNotice(error instanceof Error ? error.message : "Account evidence is unavailable.");
    }
  }, [inspectAddress]);

  const connect = useCallback(async (choice: DiscoveredWallet) => {
    policyRequest.current += 1;
    selectProvider(choice.provider);
    setActiveProvider(choice.provider);
    setWalletName(choice.name);
    setWallet({ kind: "connecting" });
    try {
      const [accounts, chainId] = await Promise.all([
        choice.provider.request({ method: "eth_requestAccounts" }) as Promise<string[]>,
        choice.provider.request({ method: "eth_chainId" }) as Promise<string>,
      ]);
      await hydrateWallet(accounts, chainId);
      setWalletPickerOpen(false);
    } catch (error) {
      selectProvider(null);
      setActiveProvider(null);
      setWalletName(null);
      setWallet({ kind: "disconnected" });
      setRegistryNotice(error instanceof Error ? `Wallet connection was not approved: ${error.message}` : "Wallet connection was not approved.");
    }
  }, [hydrateWallet]);
  const disconnect = useCallback(() => {
    policyRequest.current += 1;
    selectProvider(null);
    setActiveProvider(null);
    setWalletName(null);
    setWallet({ kind: "disconnected" });
    setRegistry(null);
    setSelectedAccount(null);
    setPosition(null);
    setWalletBalances({ collateral: null, loan: null, block: null });
    setPrepared(null);
    setTransaction(emptyTransaction());
    setRegistryNotice("Wallet disconnected locally. Browser wallet permissions remain under the wallet provider’s control.");
  }, []);

  const configurationBlockedReason = useMemo(() => {
    if (!isOwnerSigningEnabled(activeManifest)) return `${activeManifest.network.name} ${activeManifest.network.chainId} is registered evidence only; owner signing is disabled on this route`;
    if (wallet.kind === "disconnected") return "Connect the recorded owner wallet";
    if (wallet.kind === "connecting") return "Wallet connection in progress";
    if (wallet.kind === "wrong-chain") return `Switch wallet to ${activeManifest.network.name} ${activeManifest.network.chainId}`;
    if (!selectedAccount || !selectedAddress) return "Deploy or select a recorded Crest Account";
    if (selectedAccount.status !== "active" && selectedAccount.status !== "pending_policy") return `Recorded account is ${selectedAccount.status}`;
    if (selectedAccount.chainId !== String(activeManifest.network.chainId)) return "Recorded account belongs to an unsupported chain";
    if (position?.snapshot && position.snapshot.owner.toLowerCase() !== wallet.address.toLowerCase()) return "Connected wallet is not the recorded account owner";
    if (transaction.phase === "pending") return "Wait for the pending transaction receipt before another owner action";
    if (transaction.phase === "reconciliation-failed") return `Reconcile submitted hash ${transaction.hash ?? "unknown"} before another owner action`;
    if (activeManifest.gate.outcome !== "full_route") return `Qualified route is unavailable: market ${activeManifest.gate.marketGate}, vault ${activeManifest.gate.vaultGate}`;
    return null;
  }, [position, selectedAccount, selectedAddress, transaction.hash, transaction.phase, wallet]);

  const actionBlockedReason = configurationBlockedReason
    ?? (selectedAccount?.status !== "active" ? "Configure and canonically index the owner policy before moving assets" : null)
    ?? (!position?.snapshot ? "Recorded account snapshot is unavailable" : null);

  // Exits only ever reduce exposure, so they wait for neither the indexer nor a snapshot; the onchain
  // `configured` modifier and the pre-signature simulation are the gate.
  const exitBlockedReason = configurationBlockedReason;

  const gate: BorrowGate = useMemo(() => borrowGate({
    trust: activeManifest.trust.level,
    frozen: position?.snapshot ? position.snapshot.frozen : null,
    assessment: position?.assessment ?? null,
    nowMs,
  }), [nowMs, position]);

  const verifyAccount = useCallback(async (blockNumber: bigint) => {
    if (wallet.kind !== "connected" || !selectedAccount || !selectedAddress) throw new Error("Owner wallet and recorded account are required");
    const [chainId, owner, code, policyNonce] = await Promise.all([
      publicClient.getChainId(),
      publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "owner", blockNumber }),
      publicClient.getCode({ address: selectedAddress, blockNumber }),
      publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "policyNonce", blockNumber }),
    ]);
    if (chainId !== activeManifest.network.chainId) throw new Error(`RPC is not ${activeManifest.network.name} ${activeManifest.network.chainId}`);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Onchain owner does not match the connected wallet");
    if (!code || code === "0x") throw new Error("No deployed account bytecode exists at the registered address");
    if (keccak256(code).toLowerCase() !== selectedAccount.codeHash.toLowerCase()) throw new Error("Registered account code hash does not match onchain bytecode");
    const [debt, strategy] = policyNonce === 0n ? [0n, 0n] : await Promise.all([
      publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "currentDebtAssets", blockNumber }),
      publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "strategyAssets", blockNumber }),
    ]);
    preTransactionState.current = { policyNonce, debt, strategy };
    return { owner: wallet.address, account: selectedAddress };
  }, [selectedAccount, selectedAddress, wallet]);

  const simulatePrepared = useCallback(async (next: PreparedAction) => {
    if (!isOwnerSigningEnabled(activeManifest)) return;
    setPrepared(next);
    setTransaction({ phase: "simulating", action: next.action, detail: "Checking registered bytecode, direct onchain ownership, simulation, gas, and a canonical block.", recipient: next.to, calldata: next.data, selector: next.selector });
    revealTransaction();
    try {
      const block = await freshHead();
      const verified = await verifyAccount(block.number);
      if (next.expectedPolicyNonce !== undefined && preTransactionState.current?.policyNonce !== next.expectedPolicyNonce - 1n) throw new Error("Staged policy nonce no longer follows the onchain account; compile again");
      await publicClient.call({ account: verified.owner, to: next.to, data: next.data, blockNumber: block.number });
      const gas = await publicClient.estimateGas({ account: verified.owner, to: next.to, data: next.data, blockNumber: block.number });
      setTransaction({ phase: "signature-ready", action: next.action, detail: `${next.detail} Simulation succeeded at the shown block. Owner signature has not been requested.`, recipient: next.to, calldata: next.data, selector: next.selector, gas, blockNumber: block.number, blockHash: block.hash });
    } catch (error) {
      setPrepared(null);
      setTransaction({ phase: "simulation-failed", action: next.action, detail: `Simulation failed: ${errorText(error)}`, recipient: next.to, calldata: next.data, selector: next.selector });
    }
  }, [verifyAccount]);

  const compileConfiguration = useCallback(async (values: PolicyFormValues) => {
    const requestId = ++policyRequest.current;
    setIssues([]);
    setPrepared(null);
    if (configurationBlockedReason || wallet.kind !== "connected" || !selectedAddress) {
      setTransaction({ phase: "blocked", action: "configure", detail: configurationBlockedReason ?? "The owner wallet is required before policy compilation." });
      return;
    }
    if (assetIntents.collateral !== "PROTECT_AND_BORROW" || assetIntents.loan !== "EARN_STABLE") {
      setIssues([`Select PROTECT AND BORROW for ${collateralToken.symbol} and EARN STABLE for ${loanToken.symbol} before compiling this route.`]);
      setTransaction({ phase: "blocked", action: "configure", detail: "The qualified asset intents have not both been selected." });
      return;
    }
    try {
      const route = routeContextOf(activeManifest, { account: selectedAddress, owner: wallet.address });
      const draft = {
        schemaVersion: 2,
        intents: [
          { asset: route.market.collateralToken, intent: { kind: "PROTECT_AND_BORROW", marketId: route.marketId } },
          { asset: route.market.loanToken, intent: { kind: "EARN_STABLE", vaultId: `${route.chainId}:${route.vault}` } },
        ],
        maxCollateralAssets: decimalOrThrow(values.maxCollateral, route.tokens.collateralDecimals, "Collateral cap").toString(),
        debtCeilingAssets: decimalOrThrow(values.debtCeiling, route.tokens.loanDecimals, "Debt ceiling").toString(),
        maxStrategyAssets: decimalOrThrow(values.maxStrategy, route.tokens.loanDecimals, "Strategy cap").toString(),
        reserveFloorAssets: decimalOrThrow(values.reserveFloor, route.tokens.loanDecimals, "Reserve floor").toString(),
        strategyFloorAssets: decimalOrThrow(values.strategyFloor, route.tokens.loanDecimals, "Strategy floor").toString(),
        maxRepayPerActionAssets: decimalOrThrow(values.maxRepay, route.tokens.loanDecimals, "Guardian repayment cap").toString(),
        lowerLtvWad: percentPointsToWad(values.lowerLtv),
        targetLtvWad: percentPointsToWad(values.targetLtv),
        upperLtvWad: percentPointsToWad(values.upperLtv),
        criticalLtvWad: percentPointsToWad(values.criticalLtv),
        minimumNetSpreadBps: values.minimumNetSpreadBps,
        maxOracleDivergenceBps: values.maxOracleDivergenceBps,
        harvestThresholdAssets: decimalOrThrow(values.harvestThreshold, route.tokens.loanDecimals, "Harvest threshold").toString(),
        triggers: {
          freezeOnOracleDegraded: values.freezeOnOracleDegraded,
          freezeOnVaultDegraded: values.freezeOnVaultDegraded,
          freezeOnLifecycleDegraded: values.freezeOnLifecycleDegraded,
        },
        guardian: values.guardian,
      };
      const policy = compilePolicy(draft, route);
      if (!policy.ok) {
        setIssues(policy.issues);
        setTransaction({ phase: "blocked", action: "configure", detail: "Typed policy did not compile. Correct the listed fields before simulation." });
        return;
      }
      const call = toConfigurationCall(policy.policy);
      setTransaction({ phase: "simulating", action: "configure", detail: "Sign the staging message in your wallet. It is not a transaction: it moves no funds and creates no debt.", recipient: call.to, calldata: call.data, selector: call.selector });
      const provider = providerOf();
      if (!provider) throw new Error("Reconnect the owner wallet to sign the staging message");
      const head = await freshHead();
      // The API verifies consent against the finalized nonce; refuse before signing while the last change is unfinalized.
      const finalized = await publicClient.getBlock({ blockTag: "finalized" });
      const readNonce = (blockNumber: bigint) => publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "policyNonce", blockNumber });
      const [headNonce, finalizedNonce] = await Promise.all([readNonce(head.number), readNonce(finalized.number)]);
      if (headNonce !== finalizedNonce) {
        throw new Error(`Policy nonce ${headNonce} is not finalized yet (finalized nonce ${finalizedNonce}). Stage the next policy after the chain finalizes that change.`);
      }
      const message = policyStagingMessage({ chainId: activeManifest.network.chainId, account: selectedAddress, policyNonce: finalizedNonce + 1n, policyHash: policy.policy.policyHash, contentHash: policy.policy.contentHash });
      const ownerSignature = await createWalletClient({ chain: activeChain, transport: custom(provider) }).signMessage({ account: wallet.address, message });
      if (requestId !== policyRequest.current) return;
      const { intents, ...typedDraft } = draft;
      const response = await fetch(`/v1/accounts/${selectedAddress}/policies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: wallet.address, policy: typedDraft, intents, ownerSignature }),
      });
      if (requestId !== policyRequest.current) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(failure?.error ?? `Policy staging returned ${response.status}`);
      }
      const nonce = assertStagedPolicyResponse(await response.json() as unknown, {
        chainId: activeManifest.network.chainId,
        owner: wallet.address,
        account: selectedAddress,
        policyHash: policy.policy.policyHash,
        contentHash: policy.policy.contentHash,
        calldata: call.data,
        selector: call.selector,
      });
      if (requestId !== policyRequest.current) return;
      const next: PreparedAction = {
        action: "configure",
        data: call.data,
        selector: call.selector,
        to: call.to,
        policyHash: policy.policy.policyHash,
        expectedPolicyNonce: BigInt(nonce),
        detail: `Policy staged for nonce ${nonce}. Exact configure calldata prepared for ${call.to}. Guardian authority changes only if this owner-signed transaction is mined.`,
      };
      setPrepared(next);
      setTransaction({ phase: "idle", action: "configure", detail: next.detail, recipient: next.to, calldata: next.data, selector: next.selector });
      revealTransaction();
    } catch (error) {
      if (requestId !== policyRequest.current) return;
      setIssues([error instanceof Error ? error.message : "Policy staging or compilation failed"]);
      setTransaction({ phase: "blocked", action: "configure", detail: "Typed policy could not be staged; no wallet signature is available." });
    }
  }, [configurationBlockedReason, assetIntents, selectedAddress, wallet]);

  /** Prepares an exact-amount approval when the account cannot yet pull `assets`; returns whether one was needed. */
  const prepareAllowance = useCallback(async (token: RouteToken, owner: Address, account: Address, assets: bigint, action: "approve-collateral" | "approve-loan", purpose: string) => {
    const allowance = await publicClient.readContract({ address: token.address, abi: ERC20_ABI, functionName: "allowance", args: [owner, account] });
    if (allowance >= assets) return false;
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [account, assets] });
    void simulatePrepared({ action, data, selector: slice(data, 0, 4), to: token.address, allowance: { token: token.address, amount: assets }, detail: `${token.symbol} approval for exactly ${formatUnits(assets, token.decimals)} is required before ${purpose}. The approval itself moves nothing.` });
    return true;
  }, [simulatePrepared]);

  const prepareSupply = useCallback(async (amount: string) => {
    if (actionBlockedReason || !selectedAddress || wallet.kind !== "connected") {
      setTransaction({ phase: "blocked", action: "supply", detail: actionBlockedReason ?? "No registered account is available." });
      return;
    }
    if (assetIntents.collateral !== "PROTECT_AND_BORROW") {
      setTransaction({ phase: "blocked", action: "supply", detail: `Select PROTECT AND BORROW for ${collateralToken.symbol} before preparing collateral supply.` });
      return;
    }
    try {
      const assets = decimalOrThrow(amount, collateralToken.decimals, "Supply amount");
      if (await prepareAllowance(collateralToken, wallet.address, selectedAddress, assets, "approve-collateral", "the Crest Account can supply this collateral")) return;
      const data = encodeFunctionData({ abi: ACCOUNT_ACTION_ABI, functionName: "supplyCollateral", args: [assets] });
      void simulatePrepared({ action: "supply", data, selector: slice(data, 0, 4), to: selectedAddress, detail: `Supply ${formatUnits(assets, collateralToken.decimals)} ${collateralToken.symbol} as Morpho collateral. Collateral earns nothing; it only secures owner-approved debt.` });
    } catch (error) {
      setTransaction({ phase: "blocked", action: "supply", detail: error instanceof Error ? error.message : "Supply amount is invalid." });
    }
  }, [actionBlockedReason, assetIntents.collateral, prepareAllowance, selectedAddress, simulatePrepared, wallet]);

  const prepareBorrow = useCallback(async (amount: string) => {
    if (actionBlockedReason || !selectedAddress) {
      setTransaction({ phase: "blocked", action: "borrow-and-deploy", detail: actionBlockedReason ?? "No registered account is available." });
      return;
    }
    if (assetIntents.collateral !== "PROTECT_AND_BORROW" || assetIntents.loan !== "EARN_STABLE") {
      setTransaction({ phase: "blocked", action: "borrow-and-deploy", detail: `Select PROTECT AND BORROW for ${collateralToken.symbol} and EARN STABLE for ${loanToken.symbol} before requesting an owner borrow.` });
      return;
    }
    if (gate.kind === "blocked") {
      setTransaction({ phase: "blocked", action: "borrow-and-deploy", detail: gate.reason });
      return;
    }
    if (gate.kind === "acknowledge" && !degradedAcknowledged) {
      setTransaction({ phase: "blocked", action: "borrow-and-deploy", detail: "The recorded assessment is DEGRADED. Read the reason codes and acknowledge them before simulating a sandbox borrow." });
      return;
    }
    try {
      const assets = decimalOrThrow(amount, loanToken.decimals, "Borrow amount");
      if (gate.kind === "open" && gate.capacityAssets !== null && assets > gate.capacityAssets) {
        throw new Error(`Borrow exceeds the recorded owner capacity of ${formatUnits(gate.capacityAssets, loanToken.decimals)} ${loanToken.symbol}`);
      }
      const preview = await publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "previewDeposit", args: [assets] });
      const minShares = withMargin(preview, "floor");
      const data = encodeFunctionData({ abi: ACCOUNT_ACTION_ABI, functionName: "borrowAndDeploy", args: [assets, minShares] });
      const bound = gate.kind === "acknowledge"
        ? "Only the onchain debt ceiling and Morpho LLTV bound this degraded sandbox borrow."
        : gate.capacityAssets === null ? "Only the onchain debt ceiling and Morpho LLTV bound this borrow." : "The recorded owner capacity also bounds this borrow.";
      void simulatePrepared({ action: "borrow-and-deploy", borrowAssets: assets, data, selector: slice(data, 0, 4), to: selectedAddress, detail: `Borrow ${formatUnits(assets, loanToken.decimals)} ${loanToken.symbol} and deposit it into the fixed vault for at least ${minShares} shares (preview ${preview}, less ${SHARE_MARGIN_BPS} bps). ${bound}` });
    } catch (error) {
      setTransaction({ phase: "blocked", action: "borrow-and-deploy", detail: error instanceof Error ? error.message : "Borrow input is invalid." });
    }
  }, [actionBlockedReason, assetIntents, degradedAcknowledged, gate, selectedAddress, simulatePrepared]);

  const prepareExit = useCallback(async (action: ExitAction, amount: string) => {
    if (exitBlockedReason || !selectedAddress || wallet.kind !== "connected") {
      setTransaction({ phase: "blocked", action, detail: exitBlockedReason ?? "No registered account is available." });
      return;
    }
    const owner = wallet.address;
    try {
      if (action === "unfreeze") {
        const data = encodeFunctionData({ abi: ACCOUNT_ACTION_ABI, functionName: "unfreezeBorrowing" });
        void simulatePrepared({ action, data, selector: slice(data, 0, 4), to: selectedAddress, detail: "Unfreeze borrowing. Only the owner can do this, and it creates no debt by itself." });
        return;
      }
      const token = action === "withdraw-collateral" ? collateralToken : loanToken;
      const assets = decimalOrThrow(amount, token.decimals, "Amount");
      const shown = `${formatUnits(assets, token.decimals)} ${token.symbol}`;
      if (action === "owner-repay") {
        if (await prepareAllowance(loanToken, owner, selectedAddress, assets, "approve-loan", "the Crest Account can repay from your wallet")) return;
        const data = encodeFunctionData({ abi: ACCOUNT_ACTION_ABI, functionName: "ownerRepay", args: [assets] });
        void simulatePrepared({ action, data, selector: slice(data, 0, 4), to: selectedAddress, detail: `Repay up to ${shown} of Morpho debt from your wallet. The contract caps the amount at the current debt.` });
      } else if (action === "withdraw-strategy") {
        const preview = await publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "previewWithdraw", args: [assets] });
        const maxShares = withMargin(preview, "ceil");
        const data = encodeFunctionData({ abi: ACCOUNT_ACTION_ABI, functionName: "withdrawStrategy", args: [assets, owner, maxShares] });
        void simulatePrepared({ action, data, selector: slice(data, 0, 4), to: selectedAddress, detail: `Withdraw ${shown} from the fixed vault to your owner wallet, burning at most ${maxShares} shares (preview ${preview}, plus ${SHARE_MARGIN_BPS} bps).` });
      } else {
        const functionName = action === "withdraw-collateral" ? "withdrawCollateral" : "withdrawLoanToken";
        const data = encodeFunctionData({ abi: ACCOUNT_ACTION_ABI, functionName, args: [assets, owner] });
        void simulatePrepared({ action, data, selector: slice(data, 0, 4), to: selectedAddress, detail: `Withdraw ${shown} ${action === "withdraw-collateral" ? "of Morpho collateral" : "of idle reserve"} to your owner wallet. Morpho and the reserve floor still apply.` });
      }
    } catch (error) {
      setTransaction({ phase: "blocked", action, detail: error instanceof Error ? error.message : "Exit input is invalid." });
    }
  }, [exitBlockedReason, prepareAllowance, selectedAddress, simulatePrepared, wallet]);

  const submitPrepared = useCallback(async () => {
    const provider = providerOf();
    if (!isOwnerSigningEnabled(activeManifest) || !provider || wallet.kind !== "connected" || !selectedAddress || !prepared || transaction.phase !== "signature-ready" || !transaction.gas) return;
    let submittedHash: Hex | null = null;
    try {
      const walletChain = await provider.request({ method: "eth_chainId" });
      if (typeof walletChain !== "string" || Number.parseInt(walletChain, 16) !== activeManifest.network.chainId) {
        setWallet({ kind: "wrong-chain", address: wallet.address, chainId: typeof walletChain === "string" ? Number.parseInt(walletChain, 16) : -1 });
        setTransaction((current) => ({ ...current, phase: "blocked", detail: `Wallet is no longer on ${activeManifest.network.name} ${activeManifest.network.chainId}.` }));
        return;
      }
      const activeAccounts = await provider.request({ method: "eth_accounts" });
      if (!Array.isArray(activeAccounts) || !activeAccounts.some((account) => typeof account === "string" && account.toLowerCase() === wallet.address.toLowerCase())) {
        setTransaction((current) => ({ ...current, phase: "blocked", detail: "The wallet no longer exposes the recorded owner address." }));
        return;
      }
      const block = await freshHead();
      await verifyAccount(block.number);
      const borrowBlock = prepared.borrowAssets === undefined ? null : borrowSignatureBlock(gate, degradedAcknowledged, prepared.borrowAssets);
      if (borrowBlock !== null) {
        setTransaction((current) => ({ ...current, phase: "blocked", detail: borrowBlock }));
        return;
      }
      if (prepared.expectedPolicyNonce !== undefined && preTransactionState.current?.policyNonce !== prepared.expectedPolicyNonce - 1n) throw new Error("Onchain policy nonce changed after staging; compile again");
      await publicClient.call({ account: wallet.address, to: prepared.to, data: prepared.data, blockNumber: block.number });
      setTransaction((current) => ({ ...current, phase: "pending", detail: "Wallet signature requested. No transaction has been broadcast yet." }));
      const walletClient = createWalletClient({ chain: activeChain, transport: custom(provider) });
      const hash = await walletClient.sendTransaction({ account: wallet.address, chain: activeChain, to: prepared.to, data: prepared.data, gas: transaction.gas });
      submittedHash = hash;
      setTransaction((current) => ({ ...current, hash, detail: "Transaction broadcast. Waiting for a canonical receipt." }));
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 120_000 });
      if (receipt.status !== "success") {
        setTransaction((current) => ({ ...current, phase: "reverted", detail: "Canonical receipt reports a revert. No requested state change is confirmed." }));
        return;
      }
      const canonicalBlock = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
      if (canonicalBlock.hash !== receipt.blockHash) throw new Error("Receipt block is no longer canonical");
      const previous = preTransactionState.current;
      const at = receipt.blockNumber;
      const [policyNonce, debt, strategy, frozen, allowance] = await Promise.all([
        publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "policyNonce", blockNumber: at }),
        publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "currentDebtAssets", blockNumber: at }),
        publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "strategyAssets", blockNumber: at }),
        publicClient.readContract({ address: selectedAddress, abi: ACCOUNT_READ_ABI, functionName: "borrowingFrozen", blockNumber: at }),
        prepared.allowance
          ? publicClient.readContract({ address: prepared.allowance.token, abi: ERC20_ABI, functionName: "allowance", args: [wallet.address, selectedAddress], blockNumber: at })
          : Promise.resolve(0n),
      ]);
      const expectedEvent = EXPECTED_EVENT[prepared.action];
      const owner = wallet.address.toLowerCase();
      const eventFound = expectedEvent === null || parseEventLogs({ abi: ACCOUNT_EVENT_ABI, logs: receipt.logs, strict: false }).some((event) => {
        if (event.eventName !== expectedEvent || event.address.toLowerCase() !== selectedAddress.toLowerCase()) return false;
        if (event.eventName === "PolicyConfigured") {
          return typeof event.args.policyHash === "string" && event.args.policyHash.toLowerCase() === prepared.policyHash?.toLowerCase()
            && typeof event.args.marketId === "string" && event.args.marketId.toLowerCase() === activeManifest.market.id.toLowerCase()
            && typeof event.args.yieldVault === "string" && event.args.yieldVault.toLowerCase() === activeManifest.vault.address.toLowerCase();
        }
        // Value may only ever leave toward the owner wallet that signed.
        if (event.eventName === "StrategyWithdrawn" || event.eventName === "CollateralWithdrawn" || event.eventName === "LoanTokenWithdrawn") {
          return typeof event.args.receiver === "string" && event.args.receiver.toLowerCase() === owner;
        }
        return true;
      });
      const postcondition = prepared.allowance !== undefined
        ? allowance >= prepared.allowance.amount
        : prepared.action === "configure"
          ? previous !== null && policyNonce === prepared.expectedPolicyNonce && policyNonce === previous.policyNonce + 1n
          : prepared.action === "borrow-and-deploy"
            ? previous !== null && debt > previous.debt && strategy > previous.strategy
            : prepared.action === "owner-repay"
              ? previous !== null && debt < previous.debt
              : prepared.action === "withdraw-strategy"
                ? previous !== null && strategy < previous.strategy
                : prepared.action === "unfreeze" ? !frozen : true;
      const evidenceName = expectedEvent ?? "allowance";
      if (!postcondition || !eventFound) {
        setTransaction((current) => ({ ...current, phase: "reconciliation-failed", detail: `Canonical receipt exists at block ${at}, but the required ${evidenceName} postcondition was not observed. Do not treat this action as confirmed.`, blockNumber: at, blockHash: receipt.blockHash }));
        return;
      }
      setPrepared(null);
      setTransaction((current) => ({ ...current, phase: "confirmed", detail: `Canonical receipt and ${evidenceName} postcondition confirmed at block ${at}.`, blockNumber: at, blockHash: receipt.blockHash }));
      void refreshLiveState(selectedAddress);
      void refreshBalances(wallet.address);
    } catch (error) {
      const broadcastHash = submittedHash;
      if (broadcastHash === null) {
        setTransaction((current) => ({ ...current, phase: "blocked", detail: `Signature or preflight did not complete, and nothing was broadcast: ${errorText(error)}` }));
      } else {
        setTransaction((current) => ({ ...current, phase: "reconciliation-failed", hash: broadcastHash, detail: `Receipt reconciliation failed: ${errorText(error)}. The submitted hash needs explicit review before another owner action.` }));
      }
    }
  }, [degradedAcknowledged, gate, prepared, refreshBalances, refreshLiveState, selectedAddress, transaction.gas, transaction.phase, verifyAccount, wallet]);

  const inventory = useMemo(() => [
    {
      address: collateralToken.address,
      symbol: collateralToken.symbol,
      decimals: collateralToken.decimals,
      balance: walletBalances.collateral,
      intent: assetIntents.collateral,
      qualifiedIntent: "PROTECT_AND_BORROW" as const,
      reason: `One qualified Morpho market: ${activeManifest.market.id}`,
    },
    {
      address: loanToken.address,
      symbol: loanToken.symbol,
      decimals: loanToken.decimals,
      balance: walletBalances.loan,
      intent: assetIntents.loan,
      qualifiedIntent: "EARN_STABLE" as const,
      reason: `One fixed ${activeManifest.vault.generation} route: ${activeManifest.vault.address}`,
    },
  ], [assetIntents, walletBalances]);

  const busy = transaction.phase === "pending" || transaction.phase === "simulating";
  const preparedBlockedReason = transaction.action === "configure"
    ? configurationBlockedReason
    : transaction.action !== null && EXIT_SIDE[transaction.action] ? exitBlockedReason
    : actionBlockedReason ?? (prepared?.borrowAssets === undefined ? null : borrowSignatureBlock(gate, degradedAcknowledged, prepared.borrowAssets));

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="blue-field blue-grid border-b border-ink px-5 py-6 sm:px-10 sm:py-8">
        <div className="mx-auto max-w-[85rem]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-paper pb-4">
            <p className="type-display text-poster-base">Crest <span className="ml-2 font-sans text-sm font-normal normal-case">/ Owner workspace</span></p>
            <ButtonLink href="/" variant="paper">Reviewed mainnet evidence</ButtonLink>
          </div>
          <div className="mt-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="type-display text-poster-sm">{activeManifest.network.name} · chain {activeManifest.network.chainId} / one account / one market</p>
              <h1 className="mt-2 type-display text-poster-lg sm:text-poster-xl">Your account. Your call.</h1>
              <p className="mt-3 max-w-xl text-sm sm:text-base">Choose a wallet, inspect the route, then approve each action. No debt or strategy is live until a canonical receipt and recorded position say so.</p>
              <p className="mt-2 max-w-xl border-l-2 border-paper pl-3 text-sm">Only the owner creates debt. Custos can freeze or repay this account's own debt, never borrow.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {wallet.kind === "connected" ? (
                <>
                  <span className="flex min-h-11 items-center border border-paper px-4 font-mono text-sm">{walletName}: {compactAddress(wallet.address)}</span>
                  <Button variant="paper" onClick={() => { disconnect(); setWalletPickerOpen(true); }} disabled={transaction.phase === "pending" || transaction.phase === "reconciliation-failed"}>Change wallet</Button>
                  <Button variant="paper" onClick={disconnect} disabled={transaction.phase === "pending" || transaction.phase === "reconciliation-failed"}>Disconnect</Button>
                </>
              ) : <Button variant="paper" onClick={() => setWalletPickerOpen((open) => !open)} disabled={wallet.kind === "connecting"}>{wallet.kind === "connecting" ? "Connecting wallet" : walletPickerOpen ? "Hide wallet choices" : "Choose wallet"}</Button>}
            </div>
          </div>
          <WalletPicker open={walletPickerOpen} busy={wallet.kind === "connecting"} onSelect={(choice) => { void connect(choice); }} onClose={() => setWalletPickerOpen(false)} />
        </div>
      </header>
      <SandboxNotice manifest={activeManifest} />
      <nav aria-label="Owner workflow" className="border-b border-ink px-5 sm:px-10">
        <div className="mx-auto flex max-w-[85rem] gap-0 overflow-x-auto">
          {[["01", "Wallet", "#wallet"], ["02", "Position", "#position"], ["03", "Assets", "#assets"], ["04", "Set up", "#setup"], ["05", "Enter and exit", "#actions"], ["06", "Evidence", "#evidence"]].map(([number, label, href]) => (
            <a key={href} href={href} className="flex min-h-12 shrink-0 items-center gap-2 border-r border-ink px-3 text-sm hover:bg-paper-soft first:border-l sm:px-5"><span className="font-mono text-crest-700">{number}</span><span className="type-display text-poster-sm">{label}</span></a>
          ))}
        </div>
      </nav>
      <div className="mx-auto flex max-w-[85rem] flex-col gap-10 px-5 py-8 sm:gap-14 sm:px-10 sm:py-12">
        <section id="wallet" className="scroll-mt-6 space-y-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div><p className="type-display text-poster-sm text-ink-soft">01 / Start here</p><h2 className="type-display text-poster-lg">Connect or inspect</h2></div>
            <p className="max-w-md text-sm text-ink-soft">A wallet signs. Anyone can read a recorded account address without connecting.</p>
          </div>
          <Cell index="Wallet and registry" meta={wallet.kind.replaceAll("-", " ")} className="bg-paper">
            <div className="p-4 sm:p-6">
              <p className="text-sm text-ink-soft" role="status" aria-live="polite">{registryNotice}</p>
              {wallet.kind === "wrong-chain" ? (
                <div className="mt-3 flex flex-col gap-3 border-l-2 border-signal-stop pl-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
                  <p className="text-sm">Wallet chain {wallet.chainId} is not {activeManifest.network.name} {activeManifest.network.chainId}. Nothing can be simulated or signed until it is.</p>
                  <Button type="button" variant="solid" className="shrink-0" onClick={() => {
                    const provider = providerOf();
                    if (!provider) return;
                    switchToActiveChain(provider).catch((error: unknown) => setRegistryNotice(`Network switch was not completed: ${errorText(error)}`));
                  }}>Switch to chain {activeManifest.network.chainId}</Button>
                </div>
              ) : null}
              {wallet.kind === "connected" && walletBalances.block !== null ? <p className="mt-2 text-xs text-ink-soft">Wallet balances read via RPC at block {walletBalances.block.toString()}, not from the account ledger.</p> : null}
              {registry && registry.accounts.length > 0 ? (
                <label className="mt-4 grid max-w-2xl gap-1 text-sm">
                  <span className="type-display text-poster-sm">Your registered accounts</span>
                  <select value={registry.accounts.some((account) => account.address.toLowerCase() === selectedAccount?.address.toLowerCase()) ? selectedAccount?.address ?? "" : ""} disabled={transaction.phase === "pending" || transaction.phase === "reconciliation-failed"} onChange={(event) => setSelectedAccount(registry.accounts.find((account) => account.address.toLowerCase() === event.target.value.toLowerCase()) ?? null)} className="min-h-11 w-full border border-ink bg-paper px-3 font-mono text-sm">
                    <option value="">Choose an account</option>
                    {registry.accounts.map((account) => <option key={account.address} value={account.address}>{account.address} · policy {account.policyNonce}</option>)}
                  </select>
                </label>
              ) : null}
              <form className="mt-5 flex flex-col gap-2 border-t border-ink pt-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void inspectRecordedAddress(); }}>
                <label className="grid min-w-0 flex-1 gap-1 text-sm"><span className="type-display text-poster-sm">Read another account</span><input value={inspectAddress} onChange={(event) => setInspectAddress(event.target.value)} placeholder="0x… Crest Account address" className="min-h-11 w-full border border-ink bg-paper px-3 font-mono text-sm" spellCheck={false} autoComplete="off" /></label>
                <Button type="submit" variant="outline" disabled={transaction.phase === "pending" || transaction.phase === "reconciliation-failed"}>Read record</Button>
              </form>
              {inspectNotice ? <p className="mt-2 text-sm text-ink-soft" role="status">{inspectNotice}</p> : null}
            </div>
          </Cell>
          <AccountOverview wallet={wallet} position={position} hasAccount={selectedAccount !== null} />
          <p className="text-xs text-ink-soft">Account figures are recorded evidence. They are not live quotes and cannot replace an owner simulation.</p>
        </section>
        <PositionSection position={position} positionNotice={positionNotice} nowMs={nowMs} />
        <section id="assets" className="scroll-mt-6 space-y-4">
          <div><p className="type-display text-poster-sm text-ink-soft">03 / Decide before moving assets</p><h2 className="type-display text-poster-lg">Choose asset intent</h2><p className="mt-2 text-sm text-ink-soft">KEEP is the default. {collateralToken.symbol} is the only qualified collateral; {loanToken.symbol} is the fixed loan token and vault asset.</p></div>
          <InventoryTable assets={inventory} connected={wallet.kind === "connected"} locked={transaction.phase === "pending" || transaction.phase === "reconciliation-failed"} onIntentChange={changeIntent} />
        </section>
        <section id="setup" className="scroll-mt-6 space-y-4">
          <div><p className="type-display text-poster-sm text-ink-soft">04 / Owner setup</p><h2 className="type-display text-poster-lg">Deploy, then define limits</h2><p className="mt-2 text-sm text-ink-soft">Deployment is not borrowing. Policy needs a separate owner signature and canonical event.</p></div>
          <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
            <DeployPanel wallet={wallet} registry={registry} onRegistered={async () => {
              if (wallet.kind !== "connected") throw new Error("Reconnect the deploying owner wallet to inspect its registered account");
              await refreshRegistry(wallet.address);
            }} />
            <PolicyEditor draftContext={wallet.kind === "connected" && selectedAddress ? { owner: wallet.address, account: selectedAddress } : null}
              disabledReason={configurationBlockedReason} onCompile={compileConfiguration} onEdit={() => {
              policyRequest.current += 1;
              if (transaction.phase === "pending" || transaction.phase === "reconciliation-failed") return;
              setPrepared(null);
              setTransaction(emptyTransaction("Policy draft changed. Compile and simulate again before signing."));
            }} issues={issues} />
          </div>
        </section>
        <section id="actions" className="scroll-mt-6 space-y-4">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
            <div><p className="type-display text-poster-sm text-ink-soft">05 / Signature required</p><h2 className="type-display text-poster-lg">Enter and exit</h2></div>
            <p className="max-w-md text-sm text-ink-soft">Every action is simulated at a named block before your wallet is asked. Custos can freeze and repay; it can never borrow or withdraw.</p>
          </div>
          <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="grid min-w-0 gap-5">
              <EntryPanel blockedReason={actionBlockedReason} busy={busy} gate={gate} acknowledged={degradedAcknowledged} collateralBalance={walletBalances.collateral} onAcknowledge={setDegradedAcknowledged} onPrepareSupply={(amount) => void prepareSupply(amount)} onPrepareBorrow={(amount) => void prepareBorrow(amount)} />
              <ExitPanel live={liveState} notice={liveNotice} blockedReason={exitBlockedReason} busy={busy} onRefresh={selectedAddress ? () => void refreshLiveState(selectedAddress) : null} onPrepare={(action, amount) => void prepareExit(action, amount)} />
            </div>
            <div className="min-w-0 lg:sticky lg:top-4">
              <TransactionPanel account={selectedAddress} transaction={transaction} blockedReason={preparedBlockedReason} onSimulateConfiguration={() => { if (prepared?.action === "configure") void simulatePrepared(prepared); }} onSubmitPrepared={() => void submitPrepared()} />
            </div>
          </div>
        </section>
        <AccountEvidence position={position} selectedAccount={selectedAccount} positionNotice={positionNotice} />
      </div>
    </main>
  );
}
