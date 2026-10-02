"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, custom, encodeDeployData, formatEther, getAddress, keccak256 } from "viem";
import type { Abi, Address, Hex } from "viem";

import { crestAccountAbi, crestAccountCreationBytecode } from "@crest/contracts";

import { Button } from "@/components/ui/button";
import { Cell, Fact } from "@/components/ui/cell";
import { activeManifest } from "@/lib/manifest";
import { isOwnerSigningEnabled } from "@/lib/transaction-route";
import type { RecordedRegistry, WalletState } from "./types";
import { activeChain, providerOf, publicClient } from "./wallet-client";

type DeployPhase = "idle" | "simulating" | "signature-ready" | "pending" | "registration-ready" | "registered" | "failed" | "reverted";
type DeployPreview = { data: Hex; gas: bigint; feeWei: bigint; blockNumber: bigint; blockHash: Hex };

const ACCOUNT_ABI = [
  { type: "function", name: "owner", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "morpho", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
] as const;

export function DeployPanel({ wallet, registry, onRegistered }: {
  wallet: WalletState;
  registry: RecordedRegistry | null;
  onRegistered(): Promise<void>;
}) {
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [detail, setDetail] = useState("No account deployment is prepared. Every action starts with an owner simulation.");
  const [preview, setPreview] = useState<DeployPreview | null>(null);
  const [hash, setHash] = useState<Hex | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);
  const signing = useRef(false);
  const owner = wallet.kind === "connected" ? wallet.address : null;
  const storageKey = owner ? `crest:pending-deployment:${activeManifest.network.chainId}:${owner.toLowerCase()}` : null;
  const morpho = activeManifest.contracts.morpho;

  useEffect(() => {
    if (!storageKey) return;
    const stored = window.localStorage.getItem(storageKey);
    if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) {
      setHash(stored as Hex);
      setPhase("registration-ready");
      setDetail("A deployment hash was kept in this browser. Check its canonical receipt before any new deployment.");
    }
  }, [storageKey]);

  const blocked = !isOwnerSigningEnabled(activeManifest) ? `${activeManifest.network.name} is registered evidence only; deployment and registration are disabled` : !owner ? `Connect an owner wallet on ${activeManifest.network.name} ${activeManifest.network.chainId}` : registry === null ? "Recorded registry is unavailable; check it before deploying" : registry.accounts.length > 0 ? "A Crest Account is already registered for this wallet" : morpho === undefined ? "Manifest Morpho address is missing" : hash !== null ? "Reconcile the earlier deployment hash first" : null;

  const simulate = useCallback(async () => {
    if (!owner || blocked || !morpho) return;
    setPhase("simulating");
    setPreview(null);
    setDetail("Checking chain identity, manifest contract code, owner deployment, gas, and fee at one block.");
    try {
      const provider = providerOf();
      const walletChain = await provider?.request({ method: "eth_chainId" });
      if (typeof walletChain !== "string" || Number.parseInt(walletChain, 16) !== activeManifest.network.chainId) throw new Error(`Wallet is not on ${activeManifest.network.name} ${activeManifest.network.chainId}`);
      const block = await publicClient.getBlock({ blockTag: "latest" });
      if (block.number === null || block.hash === null) throw new Error("RPC did not return a simulation block");
      const [chainId, morphoCode, vaultCode, loanCode, collateralCode] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getCode({ address: getAddress(morpho.address), blockNumber: block.number }),
        publicClient.getCode({ address: getAddress(activeManifest.vault.address), blockNumber: block.number }),
        publicClient.getCode({ address: getAddress(activeManifest.market.loanToken), blockNumber: block.number }),
        publicClient.getCode({ address: getAddress(activeManifest.market.collateralToken), blockNumber: block.number }),
      ]);
      if (chainId !== activeManifest.network.chainId) throw new Error(`RPC is not ${activeManifest.network.name} ${activeManifest.network.chainId}`);
      const loan = activeManifest.contracts.loanToken;
      const collateral = activeManifest.contracts.collateralToken;
      if (!loan || !collateral || !morphoCode || !vaultCode || !loanCode || !collateralCode
        || keccak256(morphoCode).toLowerCase() !== morpho.codeHash.toLowerCase()
        || keccak256(vaultCode).toLowerCase() !== activeManifest.vault.codeHash.toLowerCase()
        || keccak256(loanCode).toLowerCase() !== loan.codeHash.toLowerCase()
        || keccak256(collateralCode).toLowerCase() !== collateral.codeHash.toLowerCase()) throw new Error("Manifest market, vault, or token bytecode drifted; deployment is blocked");
      const data = encodeDeployData({ abi: crestAccountAbi as Abi, bytecode: crestAccountCreationBytecode, args: [owner, getAddress(morpho.address)] });
      await publicClient.call({ account: owner, data, blockNumber: block.number });
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateGas({ account: owner, data, blockNumber: block.number }),
        publicClient.getGasPrice(),
      ]);
      setPreview({ data, gas, feeWei: gas * gasPrice, blockNumber: block.number, blockHash: block.hash });
      setPhase("signature-ready");
      setDetail("The exact account constructor simulated. The wallet will show the final network fee before your signature.");
    } catch (error) {
      setPhase("failed");
      setDetail(error instanceof Error ? `Deployment simulation failed: ${error.message}` : "Deployment simulation failed. No wallet signature was requested.");
    }
  }, [blocked, morpho, owner]);

  const register = useCallback(async (transactionHash: Hex) => {
    if (!isOwnerSigningEnabled(activeManifest)) throw new Error("Testnet route is not verified; registration disabled");
    if (!owner) throw new Error("Reconnect the original deploying owner wallet to register this account");
    const [receipt, finalized] = await Promise.all([
      publicClient.getTransactionReceipt({ hash: transactionHash }),
      publicClient.getBlock({ blockTag: "finalized" }),
    ]);
    if (receipt.status !== "success" || !receipt.contractAddress) {
      setPhase("reverted");
      setDetail("The deployment receipt did not create a Crest Account. No account was registered.");
      window.localStorage.removeItem(`crest:pending-deployment:${activeManifest.network.chainId}:${owner.toLowerCase()}`);
      return;
    }
    const canonical = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    if (canonical.hash !== receipt.blockHash) throw new Error("The deployment receipt block was orphaned; never register it as canonical");
    const account = getAddress(receipt.contractAddress);
    setDeployedAddress(account);
    if (finalized.number === null || receipt.blockNumber > finalized.number) {
      setPhase("registration-ready");
      setDetail(`Receipt at block ${receipt.blockNumber} is not finalized yet. Recheck registration after the chain finalizes it; do not redeploy.`);
      return;
    }
    const [code, onchainOwner, onchainMorpho] = await Promise.all([
      publicClient.getCode({ address: account, blockNumber: receipt.blockNumber }),
      publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "owner", blockNumber: receipt.blockNumber }),
      publicClient.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "morpho", blockNumber: receipt.blockNumber }),
    ]);
    if (!code || code === "0x" || onchainOwner.toLowerCase() !== owner.toLowerCase() || onchainMorpho.toLowerCase() !== morpho?.address.toLowerCase()) throw new Error("Receipt code or constructor ownership disagrees with the manifest route");
    const response = await fetch("/v1/accounts/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionHash, account, owner }),
    });
    if (!response.ok) throw new Error(`Account registration returned ${response.status}; receipt hash is retained for a safe retry`);
    const result = await response.json() as { evidence?: string; account?: { address?: string; codeHash?: string; status?: string } };
    if (result.evidence !== "canonical-deployment" || result.account?.address?.toLowerCase() !== account.toLowerCase() || result.account.codeHash?.toLowerCase() !== keccak256(code).toLowerCase() || result.account.status !== "pending_policy") throw new Error("Registration response did not match the canonical deployed account");
    setPhase("registered");
    setDetail(`Finalized deployment and registered account confirmed at block ${receipt.blockNumber}. An owner policy must still be configured and indexed before any borrowing.`);
    window.localStorage.removeItem(`crest:pending-deployment:${activeManifest.network.chainId}:${owner.toLowerCase()}`);
    await onRegistered();
  }, [morpho, onRegistered, owner]);

  const submit = useCallback(async () => {
    if (!owner || !preview || phase !== "signature-ready" || blocked || signing.current) return;
    signing.current = true;
    let broadcastHash: Hex | null = null;
    try {
      const provider = providerOf();
      if (!provider) throw new Error("Wallet provider disconnected after simulation");
      const [chain, active] = await Promise.all([
        provider.request({ method: "eth_chainId" }),
        provider.request({ method: "eth_accounts" }),
      ]);
      if (typeof chain !== "string" || Number.parseInt(chain, 16) !== activeManifest.network.chainId
        || !Array.isArray(active) || !active.some((address) => typeof address === "string" && address.toLowerCase() === owner.toLowerCase())) throw new Error("Wallet account or chain changed after simulation");
      const block = await publicClient.getBlock({ blockTag: "latest" });
      if (block.number === null) throw new Error("RPC cannot pin the pre-signature simulation");
      await publicClient.call({ account: owner, data: preview.data, blockNumber: block.number });
      setPhase("pending");
      setDetail("Owner signature requested. No account is registered until a finalized deployment receipt is verified.");
      const client = createWalletClient({ chain: activeChain, transport: custom(provider) });
      broadcastHash = await client.sendTransaction({ account: owner, chain: activeChain, data: preview.data, gas: preview.gas });
      setHash(broadcastHash);
      window.localStorage.setItem(`crest:pending-deployment:${activeManifest.network.chainId}:${owner.toLowerCase()}`, broadcastHash);
      setDetail("Deployment broadcast. Waiting for its receipt and finality; never resend an uncertain hash.");
      await publicClient.waitForTransactionReceipt({ hash: broadcastHash, confirmations: 1, timeout: 120_000 });
      await register(broadcastHash);
    } catch (error) {
      setPhase(broadcastHash ? "registration-ready" : "failed");
      setDetail(error instanceof Error ? `Deployment needs review: ${error.message}` : "Deployment needs review. A broadcast hash must be reconciled before retrying.");
    } finally {
      signing.current = false;
    }
  }, [blocked, owner, phase, preview, register]);

  const retryRegistration = useCallback(async () => {
    if (!isOwnerSigningEnabled(activeManifest)) return;
    const transactionHash = hash ?? (/^0x[0-9a-fA-F]{64}$/.test(recoveryHash) ? recoveryHash as Hex : null);
    if (!transactionHash) {
      setDetail("Enter a 32-byte deployment transaction hash, not a contract address.");
      return;
    }
    setHash(transactionHash);
    setPhase("pending");
    setDetail("Checking the original deployment receipt. This does not send another transaction.");
    try {
      await register(transactionHash);
    } catch (error) {
      setPhase("registration-ready");
      setDetail(error instanceof Error ? `Registration unavailable: ${error.message}` : "Registration unavailable. Keep the original hash and retry after checking the chain.");
    }
  }, [hash, recoveryHash, register]);

  return (
    <Cell index="01 · Deploy account" meta={phase.replaceAll("-", " ")} className="min-w-0 bg-paper">
      <div className="grid gap-5 p-4 sm:grid-cols-2">
        <div className="min-w-0">
          <h2 className="type-display text-poster-base">One account. Your signature.</h2>
          <p className="mt-2 text-sm text-ink-soft">Deploy the checked-in Crest Account with your connected wallet as owner and the manifest Morpho core as its immutable lender. Deployment is not a borrow. You still need a separately signed policy and an indexed account snapshot.</p>
          <p className="mt-3 text-sm" role="status" aria-live="polite">{detail}</p>
          {blocked ? <p className="mt-2 text-sm text-signal-stop">{blocked}</p> : null}
          {phase === "signature-ready" ? <Button type="button" variant="flame" className="mt-4 w-full" disabled={blocked !== null} onClick={() => void submit()}>Request deployment signature</Button> : <Button type="button" variant="outline" className="mt-4 w-full" disabled={blocked !== null || phase === "simulating" || phase === "pending" || phase === "registered"} onClick={() => void simulate()}>Simulate owner deployment</Button>}
          {phase === "registration-ready" ? <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => void retryRegistration()}>Recheck receipt and register</Button> : null}
          {!hash && registry?.accounts.length === 0 && owner ? (
            <form className="mt-4 border-t border-dashed border-ink/25 pt-4" onSubmit={(event) => { event.preventDefault(); void retryRegistration(); }}>
              <label className="grid gap-1 text-sm"><span>Already deployed? Paste the transaction hash to register it.</span><input value={recoveryHash} onChange={(event) => setRecoveryHash(event.target.value)} placeholder="0x… deployment transaction hash" className="min-h-11 w-full border border-ink bg-paper px-3 font-mono text-sm" spellCheck={false} /></label>
              <Button type="submit" variant="outline" className="mt-2">Check original receipt</Button>
            </form>
          ) : null}
        </div>
        <dl className="min-w-0 border-l border-ink/25 pl-4">
          <Fact label="Chain">{activeManifest.network.name} {activeManifest.network.chainId}</Fact>
          <Fact label="Owner">{owner ?? "Connect wallet"}</Fact>
          <Fact label="Constructor Morpho">{morpho?.address ?? "Unavailable"}</Fact>
          <Fact label="Destination">New, non-upgradeable Crest Account</Fact>
          <Fact label="Simulation block">{preview?.blockNumber.toString() ?? "Not simulated"}</Fact>
          <Fact label="Simulation hash">{preview?.blockHash ?? "Not simulated"}</Fact>
          <Fact label="Estimated gas">{preview?.gas.toString() ?? "Not simulated"}</Fact>
          <Fact label="Estimated network fee">{preview ? `${formatEther(preview.feeWei)} ETH, indicative` : "Not quoted"}</Fact>
          <Fact label="Transaction hash">{hash ?? "Not broadcast"}</Fact>
          <Fact label="Deployed address">{deployedAddress ?? "Not verified"}</Fact>
        </dl>
      </div>
    </Cell>
  );
}
