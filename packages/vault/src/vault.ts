import { decodeAbiParameters, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, zeroAddress } from "viem";
import type { Address, Hex, PublicClient } from "viem";

import { onchainAt, readCodeHash, simulateCall } from "@crest/chain";
import { observe } from "@crest/domain";
import type { BlockRef, Observation, ReasonCode } from "@crest/domain";
import { ERC20_BALANCE_ABI, MORPHO_ABI } from "@crest/morpho";
import type { MarketParams } from "@crest/morpho";

/** Narrow Vault V2 surface, matching the selectors `VaultV2Liquidity.sol` relies on onchain. */
export const VAULT_V2_ABI = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function liquidityAdapter() view returns (address)",
  "function liquidityData() view returns (bytes)",
  "function isAdapter(address adapter) view returns (bool)",
  "function allocation(bytes32 id) view returns (uint256)",
  "function absoluteCap(bytes32 id) view returns (uint256)",
  "function relativeCap(bytes32 id) view returns (uint256)",
  "function canSendShares(address account) view returns (bool)",
  "function canReceiveAssets(address account) view returns (bool)",
  "function managementFee() view returns (uint96)",
  "function performanceFee() view returns (uint96)",
  "function receiveSharesGate() view returns (address)",
  "function sendSharesGate() view returns (address)",
  "function receiveAssetsGate() view returns (address)",
  "function sendAssetsGate() view returns (address)",
]);

export const ADAPTER_ABI = parseAbi([
  "function parentVault() view returns (address)",
  "function asset() view returns (address)",
  "function morpho() view returns (address)",
  "function adaptiveCurveIrm() view returns (address)",
  "function expectedSupplyAssets(bytes32 marketId) view returns (uint256)",
]);

const RAY = 10n ** 27n;
const MARKET_PARAMS_TUPLE = {
  type: "tuple",
  components: [
    { name: "loanToken", type: "address" },
    { name: "collateralToken", type: "address" },
    { name: "oracle", type: "address" },
    { name: "irm", type: "address" },
    { name: "lltv", type: "uint256" },
  ],
} as const;

/** The one reviewed vault and the liquidity route Crest was deployed against. */
export interface VaultRoute {
  vault: Address;
  codeHash: Hex;
  asset: Address;
  morpho: Address;
  liquidityAdapter: Address;
  /** keccak256 of `liquidityData()`: the Morpho market id the adapter exits through. */
  liquidityMarketId: Hex;
  /** Reviewed share price; any read below it is a realized vault loss. */
  baselineSharePriceRay: bigint;
}

export interface AllocationCap {
  id: Hex;
  allocation: bigint;
  absoluteCap: bigint;
  relativeCapWad: bigint;
}

export interface VaultSnapshot {
  vault: Address;
  asset: Address;
  totalAssets: bigint;
  totalSupply: bigint;
  /** Assets per share, RAY-scaled across share and asset decimals. Null when no share exists. */
  sharePriceRay: bigint | null;
  fees: { performanceFeeWad: bigint; managementFeePerSecondWad: bigint };
  /** Vault V2 has no pause switch. Gates are its only transfer controls; zero address means open. */
  gates: { receiveShares: Address; sendShares: Address; receiveAssets: Address; sendAssets: Address };
  liquidityAdapter: Address;
  liquidityMarketId: Hex;
  caps: { adapter: AllocationCap; collateral: AllocationCap; market: AllocationCap } | null;
  idleAssets: bigint;
  adapterLiquidityAssets: bigint;
  /** Vault-wide normal-exit capacity: idle assets plus the native adapter exit. Never TVL, never `maxWithdraw`. */
  capacityAssets: bigint;
}

export interface VaultPosition {
  account: Address;
  shares: bigint;
  /** What the shares are worth on paper. Not withdrawable by itself. */
  quotedAssets: bigint;
  /** Quoted assets bounded by vault capacity and gates: the only amount a strategy repayment may count on. */
  availableAssets: bigint;
}

export interface WithdrawalSimulation {
  owner: Address;
  assets: bigint;
  previewShares: bigint;
  simulatedShares: bigint | null;
  revert: string | null;
}

/** Vault V2 accounting ids a `MorphoMarketV1AdapterV2` allocation touches. All three must be nonzero to exit. */
export function allocationIds(adapter: Address, params: MarketParams): { adapter: Hex; collateral: Hex; market: Hex } {
  return {
    adapter: keccak256(encodeAbiParameters([{ type: "string" }, { type: "address" }], ["this", adapter])),
    collateral: keccak256(encodeAbiParameters([{ type: "string" }, { type: "address" }], ["collateralToken", params.collateralToken])),
    market: keccak256(encodeAbiParameters([{ type: "string" }, { type: "address" }, MARKET_PARAMS_TUPLE], ["this/marketParams", adapter, params])),
  };
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Reads the fixed vault at one block and reproduces `VaultV2Liquidity.vaultCapacity` exactly.
 *
 * Identity (bytecode, asset) and route (adapter, liquidity data, adapter wiring) are re-proven on every read.
 * A drifted route contributes no adapter liquidity, the same way the contract returns zero for it.
 */
export async function readVault(client: PublicClient, block: BlockRef, route: VaultRoute): Promise<Observation<VaultSnapshot>> {
  const provenance = onchainAt(block);
  const at = { blockNumber: block.number };
  const read = <const F extends string>(functionName: F, args?: readonly unknown[]) =>
    client.readContract({ address: route.vault, abi: VAULT_V2_ABI, functionName, ...(args ? { args } : {}), ...at } as never) as Promise<unknown>;

  const code = await readCodeHash(client, block, route.vault, route.codeHash);
  if (code.value === null) return observe<VaultSnapshot>(null, provenance, code.reasons);
  const reasons: ReasonCode[] = [...code.reasons];

  let base: unknown[];
  try {
    base = await Promise.all([
      read("asset"),
      read("decimals"),
      read("totalAssets"),
      read("totalSupply"),
      read("liquidityAdapter"),
      read("liquidityData"),
      read("performanceFee"),
      read("managementFee"),
      read("receiveSharesGate"),
      read("sendSharesGate"),
      read("receiveAssetsGate"),
      read("sendAssetsGate"),
    ]);
  } catch {
    return observe<VaultSnapshot>(null, provenance, reasons);
  }
  const [asset, shareDecimals, totalAssets, totalSupply, liquidityAdapter, liquidityData, performanceFeeWad, managementFeePerSecondWad, ...gateList] =
    base as [Address, number, bigint, bigint, Address, Hex, bigint, bigint, Address, Address, Address, Address];
  const [receiveShares, sendShares, receiveAssets, sendAssets] = gateList as [Address, Address, Address, Address];
  if (!sameAddress(asset, route.asset)) reasons.push("identity_mismatch");

  let idleAssets: bigint;
  let assetDecimals: number;
  try {
    [idleAssets, assetDecimals] = await Promise.all([
      client.readContract({ address: asset, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [route.vault], ...at }),
      client.readContract({ address: asset, abi: VAULT_V2_ABI, functionName: "decimals", ...at }),
    ]);
  } catch {
    return observe<VaultSnapshot>(null, provenance, reasons);
  }

  const liquidityMarketId = keccak256(liquidityData);
  const routeMatches = sameAddress(liquidityAdapter, route.liquidityAdapter) && liquidityMarketId === route.liquidityMarketId.toLowerCase();
  let caps: VaultSnapshot["caps"] = null;
  let adapterLiquidityAssets = 0n;

  if (!routeMatches || liquidityAdapter === zeroAddress || liquidityData.length !== 2 + 160 * 2) {
    reasons.push("route_drift");
  } else {
    try {
      const [loanToken, collateralToken, oracle, irm, lltv] = decodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        liquidityData,
      );
      const params: MarketParams = { loanToken, collateralToken, oracle, irm, lltv };
      const ids = allocationIds(liquidityAdapter, params);
      const adapterRead = <const F extends string>(functionName: F, args?: readonly unknown[]) =>
        client.readContract({ address: liquidityAdapter, abi: ADAPTER_ABI, functionName, ...(args ? { args } : {}), ...at } as never) as Promise<unknown>;
      const [isAdapter, parentVault, adapterAsset, adapterMorpho, adapterIrm, ...capReads] = await Promise.all([
        read("isAdapter", [liquidityAdapter]),
        adapterRead("parentVault"),
        adapterRead("asset"),
        adapterRead("morpho"),
        adapterRead("adaptiveCurveIrm"),
        ...[ids.adapter, ids.collateral, ids.market].flatMap((id) => [read("allocation", [id]), read("absoluteCap", [id]), read("relativeCap", [id])]),
      ]);
      const cap = (index: number, id: Hex): AllocationCap => ({
        id,
        allocation: capReads[index * 3] as bigint,
        absoluteCap: capReads[index * 3 + 1] as bigint,
        relativeCapWad: capReads[index * 3 + 2] as bigint,
      });
      caps = { adapter: cap(0, ids.adapter), collateral: cap(1, ids.collateral), market: cap(2, ids.market) };

      const wired = isAdapter === true
        && sameAddress(parentVault as Address, route.vault)
        && sameAddress(adapterAsset as Address, route.asset)
        && sameAddress(adapterMorpho as Address, route.morpho)
        && sameAddress(loanToken, route.asset)
        && sameAddress(irm, adapterIrm as Address);
      if (!wired) {
        reasons.push("route_drift");
      } else if (caps.adapter.allocation !== 0n && caps.collateral.allocation !== 0n && caps.market.allocation !== 0n) {
        // Vault V2 rejects deallocation when any accounting allocation is zero, even with residual quoted value.
        const [supplied, market, morphoBalance] = await Promise.all([
          adapterRead("expectedSupplyAssets", [liquidityMarketId]) as Promise<bigint>,
          client.readContract({ address: route.morpho, abi: MORPHO_ABI, functionName: "market", args: [liquidityMarketId], ...at }),
          client.readContract({ address: asset, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [route.morpho], ...at }),
        ]);
        // Interest raises supply and borrow equally, so stored totals give the same free liquidity as accrued ones.
        const free = market[0] - market[2];
        const bound = free < morphoBalance ? free : morphoBalance;
        adapterLiquidityAssets = supplied < bound ? supplied : bound;
      }
    } catch {
      return observe<VaultSnapshot>(null, provenance, [...reasons, "unreadable"]);
    }
  }

  const scale = 10n ** BigInt(Math.abs(shareDecimals - assetDecimals));
  const sharePriceRay = totalSupply === 0n
    ? null
    : shareDecimals >= assetDecimals
      ? (totalAssets * scale * RAY) / totalSupply
      : (totalAssets * RAY) / (totalSupply * scale);
  if (sharePriceRay !== null && sharePriceRay < route.baselineSharePriceRay) reasons.push("vault_loss");

  return observe(
    {
      vault: route.vault,
      asset,
      totalAssets,
      totalSupply,
      sharePriceRay,
      fees: { performanceFeeWad, managementFeePerSecondWad },
      gates: { receiveShares, sendShares, receiveAssets, sendAssets },
      liquidityAdapter,
      liquidityMarketId,
      caps,
      idleAssets,
      adapterLiquidityAssets,
      capacityAssets: idleAssets + adapterLiquidityAssets,
    },
    provenance,
    reasons,
  );
}

/**
 * Reproduces `VaultV2Liquidity.available` for one account against a vault snapshot from the same block.
 * The snapshot's own reasons carry over, because the bound is only as trustworthy as the capacity it uses.
 */
export async function readVaultPosition(
  client: PublicClient,
  block: BlockRef,
  route: VaultRoute,
  vault: Observation<VaultSnapshot>,
  account: Address,
): Promise<Observation<VaultPosition>> {
  const provenance = onchainAt(block);
  if (vault.value === null) return observe<VaultPosition>(null, provenance, vault.reasons);
  const at = { blockNumber: block.number };
  try {
    const shares = await client.readContract({ address: route.vault, abi: VAULT_V2_ABI, functionName: "balanceOf", args: [account], ...at });
    const [quotedAssets, canSend, canReceive] = await Promise.all([
      client.readContract({ address: route.vault, abi: VAULT_V2_ABI, functionName: "convertToAssets", args: [shares], ...at }),
      client.readContract({ address: route.vault, abi: VAULT_V2_ABI, functionName: "canSendShares", args: [account], ...at }),
      client.readContract({ address: route.vault, abi: VAULT_V2_ABI, functionName: "canReceiveAssets", args: [account], ...at }),
    ]);
    const gated = !canSend || !canReceive;
    const capacity = vault.value.capacityAssets;
    const availableAssets = gated ? 0n : quotedAssets < capacity ? quotedAssets : capacity;
    return observe({ account, shares, quotedAssets, availableAssets }, provenance, [...vault.reasons, ...(gated ? (["withdrawal_gated"] as const) : [])]);
  } catch {
    return observe<VaultPosition>(null, provenance, vault.reasons);
  }
}

/**
 * Simulates the exact `withdraw(assets, owner, owner)` a strategy exit would make, at the pinned block.
 * Receiver and owner are the same account: a Crest strategy exit never pays anyone else.
 */
export async function simulateWithdrawal(
  client: PublicClient,
  block: BlockRef,
  route: VaultRoute,
  position: Observation<VaultPosition>,
  assets: bigint,
): Promise<Observation<WithdrawalSimulation>> {
  const provenance = onchainAt(block);
  if (position.value === null) return observe<WithdrawalSimulation>(null, provenance, position.reasons);
  const owner = position.value.account;
  const reasons: ReasonCode[] = [...position.reasons];
  if (assets > position.value.availableAssets) reasons.push("withdrawal_constrained");

  let previewShares: bigint;
  try {
    previewShares = await client.readContract({ address: route.vault, abi: VAULT_V2_ABI, functionName: "previewWithdraw", args: [assets], blockNumber: block.number });
  } catch {
    return observe<WithdrawalSimulation>(null, provenance, reasons);
  }
  const data = encodeFunctionData({ abi: VAULT_V2_ABI, functionName: "withdraw", args: [assets, owner, owner] });
  const call = await simulateCall(client, block, { from: owner, to: route.vault, data });
  reasons.push(...call.reasons);
  if (call.value === null || !call.value.ok) {
    return observe({ owner, assets, previewShares, simulatedShares: null, revert: call.value?.ok === false ? call.value.revert : null }, provenance, reasons);
  }
  const simulatedShares = decodeFunctionResult({ abi: VAULT_V2_ABI, functionName: "withdraw", data: call.value.returnData });
  if (simulatedShares !== previewShares) reasons.push("conflict");
  return observe({ owner, assets, previewShares, simulatedShares, revert: null }, provenance, reasons);
}
