"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getAddress, keccak256, parseAbi, type Hex } from "viem";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Cell, Fact } from "@/components/ui/cell";
import { activeManifest, activeTokens } from "@/lib/manifest";
import { decimal, percentFromWad } from "./format";
import { publicClient } from "./wallet-client";

const MORPHO_ABI = parseAbi([
  "function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);
const ORACLE_ABI = parseAbi(["function price() view returns (uint256)"]);
const VAULT_ABI = parseAbi(["function asset() view returns (address)", "function totalAssets() view returns (uint256)"]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const { collateral, loan } = activeTokens;
const morpho = activeManifest.contracts.morpho;
const marketId = activeManifest.market.id as Hex;
const vaultAddress = getAddress(activeManifest.vault.address);
const evidenceBlock = activeManifest.evidence.block.number;

/** One fact read live at a pinned block, or the manifest's recorded value with the reason the live read failed. */
type Reading<T> = { source: "live"; value: T } | { source: "manifest"; value: T | null; reason: string };

type RouteReadings = {
  blockNumber: bigint;
  blockTime: bigint;
  paramsMatch: Reading<boolean>;
  morphoCode: Reading<boolean>;
  vaultCode: Reading<boolean>;
  vaultAsset: Reading<boolean>;
  liquidity: Reading<bigint>;
  oraclePrice: Reading<bigint>;
  vaultTotalAssets: Reading<bigint>;
  vaultIdleAssets: Reading<bigint>;
};

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

function reasonOf(error: unknown): string {
  if (error instanceof Error) return ("shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : error.message).split("\n")[0] ?? "read failed";
  return "read failed";
}

async function read<T>(task: () => Promise<T>, fallback: T | null): Promise<Reading<T>> {
  try {
    return { source: "live", value: await task() };
  } catch (error) {
    return { source: "manifest", value: fallback, reason: reasonOf(error) };
  }
}

async function readRoute(): Promise<RouteReadings> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const at = { blockNumber };
  const morphoAddress = morpho === undefined ? null : getAddress(morpho.address);
  const [paramsMatch, morphoCode, vaultCode, vaultAsset, liquidity, oraclePrice, vaultTotalAssets, vaultIdleAssets] = await Promise.all([
    read(async () => {
      if (morphoAddress === null) throw new Error("manifest has no Morpho deployment");
      const [loanToken, collateralToken, oracle, irm, lltv] = await publicClient.readContract({ address: morphoAddress, abi: MORPHO_ABI, functionName: "idToMarketParams", args: [marketId], ...at });
      const m = activeManifest.market;
      return same(loanToken, m.loanToken) && same(collateralToken, m.collateralToken) && same(oracle, m.oracle) && same(irm, m.irm) && lltv === BigInt(m.lltv);
    }, null),
    read(async () => {
      if (morphoAddress === null || morpho === undefined) throw new Error("manifest has no Morpho deployment");
      const code = await publicClient.getCode({ address: morphoAddress, ...at });
      return code !== undefined && same(keccak256(code), morpho.codeHash);
    }, null),
    read(async () => {
      const code = await publicClient.getCode({ address: vaultAddress, ...at });
      return code !== undefined && same(keccak256(code), activeManifest.vault.codeHash);
    }, null),
    read(async () => same(await publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "asset", ...at }), activeManifest.vault.asset), null),
    read(async () => {
      if (morphoAddress === null) throw new Error("manifest has no Morpho deployment");
      const [totalSupply, , totalBorrow] = await publicClient.readContract({ address: morphoAddress, abi: MORPHO_ABI, functionName: "market", args: [marketId], ...at });
      return totalSupply - totalBorrow;
    }, BigInt(activeManifest.market.liquidityAssets)),
    read(() => publicClient.readContract({ address: getAddress(activeManifest.market.oracle), abi: ORACLE_ABI, functionName: "price", ...at }), null),
    read(() => publicClient.readContract({ address: vaultAddress, abi: VAULT_ABI, functionName: "totalAssets", ...at }), null),
    read(() => publicClient.readContract({ address: loan.address, abi: ERC20_ABI, functionName: "balanceOf", args: [vaultAddress], ...at }), null),
  ]);
  return { blockNumber, blockTime: block.timestamp, paramsMatch, morphoCode, vaultCode, vaultAsset, liquidity, oraclePrice, vaultTotalAssets, vaultIdleAssets };
}

function Check({ reading, pass, fail }: { reading: Reading<boolean> | undefined; pass: string; fail: string }) {
  if (reading === undefined) return <>Reading</>;
  if (reading.source === "manifest") return <span className="text-signal-degraded">Not verified live: {reading.reason}</span>;
  return reading.value ? <span className="text-signal-verified">{pass}</span> : <span className="text-signal-stop">{fail}</span>;
}

function Amount({ reading, format }: { reading: Reading<bigint> | undefined; format: (value: bigint) => string }) {
  if (reading === undefined) return <>Reading</>;
  if (reading.source === "live") return <>{format(reading.value)}</>;
  return (
    <span>
      {reading.value === null ? "Unavailable" : `${format(reading.value)} at manifest block ${evidenceBlock}`}
      <span className="block text-xs text-signal-degraded">Live read failed: {reading.reason}</span>
    </span>
  );
}

const tokens = (value: bigint) => decimal(value.toString(), loan.decimals, loan.symbol);

/**
 * Route verification (DESIGN-SYSTEMS 7.10): the exact Morpho market and fixed vault, re-read at one live block.
 * Identity checks never fall back; a failed live read shows the manifest's recorded value beside the reason, so
 * evidence is never upgraded from recorded to live.
 */
export function RouteVerification() {
  const [readings, setReadings] = useState<RouteReadings | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setReadings(await readRoute());
      setFailure(null);
    } catch (error) {
      setReadings(null);
      setFailure(reasonOf(error));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const sandbox = activeManifest.trust.level === "sandbox";
  const meta = readings ? `Live block ${readings.blockNumber.toString()}` : failure ? "Manifest only" : "Reading";
  return (
    <Cell index="Route verification" meta={meta} className="bg-paper">
      <div className="flex flex-col gap-3 border-b border-ink p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={sandbox ? "degraded" : "verified"}>{sandbox ? "Sandbox route" : "Reviewed route"}</Badge>
          <span className="text-sm">Gate {activeManifest.gate.outcome.replace("_", " ")}: market {activeManifest.gate.marketGate}, vault {activeManifest.gate.vaultGate}</span>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden className="size-4" />{busy ? "Reading chain" : "Re-read chain"}</Button>
      </div>
      <p className="px-4 pt-3 text-sm text-ink-soft" role="status" aria-live="polite">
        {readings
          ? `Read at block ${readings.blockNumber.toString()} (${new Date(Number(readings.blockTime) * 1000).toISOString()}). Manifest evidence is from finalized block ${evidenceBlock}.`
          : failure ? `The chain could not be read (${failure}). Every value below is manifest evidence from finalized block ${evidenceBlock}, not live.` : "Reading the route at the latest block."}
      </p>
      <div className="grid gap-px bg-ink/20 lg:grid-cols-2">
        <dl className="bg-paper px-4 py-2">
          <p className="type-display pt-2 text-poster-sm uppercase">Morpho market</p>
          <Fact label="Market id">{activeManifest.market.id}</Fact>
          <Fact label="Five market params"><Check reading={readings?.paramsMatch} pass="Match the manifest" fail="Differ from the manifest" /></Fact>
          <Fact label="Collateral / loan">{collateral.symbol} {collateral.address} / {loan.symbol} {loan.address}</Fact>
          <Fact label="Oracle">{activeManifest.market.oracle}</Fact>
          <Fact label="Oracle price">
            {readings === null ? (failure ? "Unavailable" : "Reading") : readings.oraclePrice.source === "live"
              ? readings.oraclePrice.value.toString()
              : <span className="text-signal-stop">Reverted or unreadable: {readings.oraclePrice.reason}. Treat the collateral price as stale.</span>}
          </Fact>
          <Fact label="IRM">{activeManifest.market.irm}</Fact>
          <Fact label="Morpho LLTV">{percentFromWad(activeManifest.market.lltv)}</Fact>
          <Fact label="Morpho bytecode"><Check reading={readings?.morphoCode} pass="Code hash matches" fail="Code hash differs" /></Fact>
          <Fact label="Borrowable liquidity">{readings === null && failure ? `${tokens(BigInt(activeManifest.market.liquidityAssets))} at manifest block ${evidenceBlock}` : <Amount reading={readings?.liquidity} format={tokens} />}</Fact>
        </dl>
        <dl className="bg-paper px-4 py-2">
          <p className="type-display pt-2 text-poster-sm uppercase">Fixed vault</p>
          <Fact label="Vault">{activeManifest.vault.address}</Fact>
          <Fact label="Interface">{activeManifest.vault.generation}</Fact>
          <Fact label="Asset"><Check reading={readings?.vaultAsset} pass={`${loan.symbol}, matches the loan token`} fail="Not the loan token" /></Fact>
          <Fact label="Vault bytecode"><Check reading={readings?.vaultCode} pass="Code hash matches" fail="Code hash differs" /></Fact>
          <Fact label="Liquidity adapter">{/^0x0{40}$/i.test(activeManifest.vault.governance.liquidityAdapter) ? "None: exits draw on idle assets only" : activeManifest.vault.governance.liquidityAdapter}</Fact>
          <Fact label="Quoted total assets"><Amount reading={readings?.vaultTotalAssets} format={tokens} /></Fact>
          <Fact label="Idle assets now"><Amount reading={readings?.vaultIdleAssets} format={tokens} /></Fact>
          <Fact label="Withdrawable at evidence">{tokens(BigInt(activeManifest.vault.withdrawableAssets))} at block {evidenceBlock}</Fact>
          <Fact label="Downstream allocations">{activeManifest.vault.downstreamAllocations.length === 0 ? "None" : activeManifest.vault.downstreamAllocations.map((entry) => `${entry.marketId.slice(0, 10)}… (${entry.liquidityRole})`).join(", ")}</Fact>
        </dl>
      </div>
    </Cell>
  );
}
