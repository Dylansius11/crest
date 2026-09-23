import { fileURLToPath } from "node:url";

import { encodeAbiParameters, keccak256 } from "viem";
import type { Address, Hex } from "viem";
import { describe, expect, test } from "vitest";

import { fakeChain } from "@crest/chain/testing";
import type { FakeCall } from "@crest/chain/testing";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { ERC20_BALANCE_ABI, MORPHO_ABI } from "@crest/morpho";
import type { MarketParams } from "@crest/morpho";

import { ADAPTER_ABI, allocationIds, readVault, readVaultPosition, simulateWithdrawal, VAULT_V2_ABI, vaultRouteOf } from "./index.ts";
import type { VaultRoute } from "./index.ts";

// Live Steakhouse USDG Vault V2 state at Robinhood block 70219746.
const block = { number: 70_219_746n, hash: "0x5ea959fa529f1748b478942a34d60baf39f65fcaa557921c99ee5e79e87e7285", timestamp: 1_790_136_895n } as const;
const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const MORPHO: Address = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010";
const ADAPTER: Address = "0x44ABc1d6cCFF2696d98890B92E2157AF242179c2";
const VAULT: Address = "0xBeEff033F34C046626B8D0A041844C5d1A5409dd";
const CODE: Hex = "0x60806040";
const liquidityParams: MarketParams = {
  loanToken: USDG,
  collateralToken: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
  oracle: "0xE64849bd4AD03DfaBbe02bb521de19997a19055f",
  irm: "0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1",
  lltv: 915_000_000_000_000_000n,
};
const liquidityData = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
  [liquidityParams.loanToken, liquidityParams.collateralToken, liquidityParams.oracle, liquidityParams.irm, liquidityParams.lltv],
);
// Independently derived with `cast keccak` / `cast abi-encode` from the same inputs.
const IDS = {
  adapter: "0xaab5cdd55c849063a01c2c2e559d74abb5e42a63be313c7eec646caac50871cd",
  collateral: "0x766b4edc6aca324a332db393d1f55a87fad3e151f695e95fa29c1334ea54c051",
  market: "0xf67da829bb7756e3da920aa7291d486900ddfc17b735128872376ecc8c042fb8",
} as const;
const LIQUIDITY_MARKET = "0xc845da65a020ddca5f132efa8fea79676d8edfdea504226a4c01e7a9e34cddd6";
const IDLE = 1_212_718_467_507n;
const SUPPLIED = 328_136_354_528_994n;
const MARKET_FREE = 337_461_951_186_405n - 304_957_729_793_987n;
const CAPACITY = IDLE + MARKET_FREE;
const SHARE_PRICE_RAY = 1_007_797_674_610_132_672_942_793_339n;

const route: VaultRoute = {
  vault: VAULT,
  codeHash: keccak256(CODE),
  asset: USDG,
  morpho: MORPHO,
  liquidityAdapter: ADAPTER,
  liquidityMarketId: LIQUIDITY_MARKET,
  baselineSharePriceRay: 1_007_219_646_915_321_488_459_496_036n,
};

interface Scenario {
  asset?: Address;
  liquidityAdapter?: Address;
  adapterAllocation?: bigint;
  extra?: FakeCall[];
}

function liveVault(scenario: Scenario = {}) {
  const vaultCall = (functionName: string, result: unknown, args?: readonly unknown[]): FakeCall => ({
    address: VAULT,
    abi: VAULT_V2_ABI,
    functionName,
    result,
    ...(args === undefined ? {} : { args }),
  });
  return fakeChain({
    block,
    code: { [VAULT]: CODE },
    calls: [
      vaultCall("asset", scenario.asset ?? USDG),
      vaultCall("decimals", 18),
      vaultCall("totalAssets", 497_582_518_117_104n),
      vaultCall("totalSupply", 493_732_552_329_607_418_927_491_034n),
      vaultCall("liquidityAdapter", scenario.liquidityAdapter ?? ADAPTER),
      vaultCall("liquidityData", liquidityData),
      vaultCall("isAdapter", true, [ADAPTER]),
      vaultCall("managementFee", 0n),
      vaultCall("performanceFee", 0n),
      vaultCall("receiveSharesGate", "0x0000000000000000000000000000000000000000"),
      vaultCall("sendSharesGate", "0x0000000000000000000000000000000000000000"),
      vaultCall("receiveAssetsGate", "0x0000000000000000000000000000000000000000"),
      vaultCall("sendAssetsGate", "0x0000000000000000000000000000000000000000"),
      vaultCall("allocation", scenario.adapterAllocation ?? 496_369_436_865_448n, [IDS.adapter]),
      vaultCall("allocation", 328_136_342_947_538n, [IDS.collateral]),
      vaultCall("allocation", 328_136_342_947_538n, [IDS.market]),
      vaultCall("absoluteCap", 1_000_000_000_000_000_000_000n, [IDS.adapter]),
      vaultCall("absoluteCap", 1_000_000_000_000_000n, [IDS.collateral]),
      vaultCall("absoluteCap", 1_000_000_000_000_000n, [IDS.market]),
      vaultCall("relativeCap", 1_000_000_000_000_000_000n, [IDS.adapter]),
      vaultCall("relativeCap", 1_000_000_000_000_000_000n, [IDS.collateral]),
      vaultCall("relativeCap", 1_000_000_000_000_000_000n, [IDS.market]),
      { address: USDG, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [VAULT], result: IDLE },
      { address: USDG, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [MORPHO], result: 51_952_860_715_997n },
      { address: USDG, abi: VAULT_V2_ABI, functionName: "decimals", result: 6 },
      { address: ADAPTER, abi: ADAPTER_ABI, functionName: "parentVault", result: VAULT },
      { address: ADAPTER, abi: ADAPTER_ABI, functionName: "asset", result: USDG },
      { address: ADAPTER, abi: ADAPTER_ABI, functionName: "morpho", result: MORPHO },
      { address: ADAPTER, abi: ADAPTER_ABI, functionName: "adaptiveCurveIrm", result: liquidityParams.irm },
      { address: ADAPTER, abi: ADAPTER_ABI, functionName: "expectedSupplyAssets", args: [LIQUIDITY_MARKET], result: SUPPLIED },
      {
        address: MORPHO,
        abi: MORPHO_ABI,
        functionName: "market",
        args: [LIQUIDITY_MARKET],
        result: [337_461_951_186_405n, 334_471_694_544_945_626_090n, 304_957_729_793_987n, 301_911_807_310_912_279_730n, 1_790_136_867n, 0n],
      },
      ...(scenario.extra ?? []),
    ],
  });
}

describe("allocation ids", () => {
  test("derive the three Vault V2 accounting ids exactly as the adapter does", () => {
    expect(allocationIds(ADAPTER, liquidityParams)).toEqual(IDS);
  });

  test("the reviewed manifest binds the liquidity market whose id is keccak256 of the live liquidity data", async () => {
    const bound = vaultRouteOf(await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url))));
    expect(bound).toMatchObject({ vault: VAULT, asset: USDG, morpho: MORPHO, liquidityAdapter: ADAPTER, liquidityMarketId: keccak256(liquidityData) });
  });
});

describe("readVault", () => {
  test("bounds capacity by idle assets plus the native adapter exit, never by TVL or maxWithdraw", async () => {
    const vault = await readVault(liveVault(), block, route);
    expect(vault.status).toBe("normal");
    expect(vault.value).toMatchObject({
      totalAssets: 497_582_518_117_104n,
      sharePriceRay: SHARE_PRICE_RAY,
      idleAssets: IDLE,
      adapterLiquidityAssets: MARKET_FREE,
      capacityAssets: CAPACITY,
      fees: { performanceFeeWad: 0n, managementFeePerSecondWad: 0n },
    });
    expect(vault.value?.capacityAssets).toBeLessThan(vault.value?.totalAssets ?? 0n);
  });

  test("a changed liquidity route is drift and contributes nothing beyond idle assets", async () => {
    const vault = await readVault(liveVault({ liquidityAdapter: "0x00000000000000000000000000000000000000d1" }), block, route);
    expect(vault.reasons).toContain("route_drift");
    expect(vault.value?.capacityAssets).toBe(IDLE);
  });

  test("a zero accounting allocation blocks deallocation, so the adapter exit counts as zero", async () => {
    const vault = await readVault(liveVault({ adapterAllocation: 0n }), block, route);
    expect(vault.value?.adapterLiquidityAssets).toBe(0n);
    expect(vault.value?.capacityAssets).toBe(IDLE);
  });

  test("a share price below the reviewed baseline is a vault loss", async () => {
    const vault = await readVault(liveVault(), block, { ...route, baselineSharePriceRay: SHARE_PRICE_RAY + 1n });
    expect(vault).toMatchObject({ status: "degraded", reasons: ["vault_loss"] });
  });

  test("a vault whose asset is not the loan token is an identity mismatch", async () => {
    const vault = await readVault(liveVault({ asset: "0x00000000000000000000000000000000000000e1" }), block, route);
    expect(vault.reasons).toContain("identity_mismatch");
  });

  test("bytecode other than the reviewed vault is an identity mismatch", async () => {
    const vault = await readVault(liveVault(), block, { ...route, codeHash: `0x${"00".repeat(32)}` });
    expect(vault.reasons).toContain("identity_mismatch");
  });
});

const OWNER: Address = "0x00000000000000000000000000000000000000c2";

function position(options: { shares: bigint; quoted: bigint; canSend?: boolean; extra?: FakeCall[] }) {
  return liveVault({
    extra: [
      { address: VAULT, abi: VAULT_V2_ABI, functionName: "balanceOf", args: [OWNER], result: options.shares },
      { address: VAULT, abi: VAULT_V2_ABI, functionName: "convertToAssets", args: [options.shares], result: options.quoted },
      { address: VAULT, abi: VAULT_V2_ABI, functionName: "canSendShares", args: [OWNER], result: options.canSend ?? true },
      { address: VAULT, abi: VAULT_V2_ABI, functionName: "canReceiveAssets", args: [OWNER], result: true },
      ...(options.extra ?? []),
    ],
  });
}

describe("readVaultPosition", () => {
  test("quoted assets above vault capacity only count up to capacity", async () => {
    const client = position({ shares: 10n ** 30n, quoted: CAPACITY + 1n });
    const account = await readVaultPosition(client, block, route, await readVault(client, block, route), OWNER);
    expect(account.value).toMatchObject({ quotedAssets: CAPACITY + 1n, availableAssets: CAPACITY });
  });

  test("a gate that refuses the account's shares makes nothing withdrawable", async () => {
    const client = position({ shares: 10n ** 18n, quoted: 1_007_797n, canSend: false });
    const account = await readVaultPosition(client, block, route, await readVault(client, block, route), OWNER);
    expect(account).toMatchObject({ status: "degraded", reasons: ["withdrawal_gated"] });
    expect(account.value?.availableAssets).toBe(0n);
  });

  test("inherits the vault's degradation, because its bound depends on that snapshot", async () => {
    const client = position({ shares: 10n ** 18n, quoted: 1_007_797n });
    const drifted = await readVault(client, block, { ...route, baselineSharePriceRay: SHARE_PRICE_RAY + 1n });
    const account = await readVaultPosition(client, block, route, drifted, OWNER);
    expect(account.reasons).toContain("vault_loss");
  });
});

describe("simulateWithdrawal", () => {
  const withdraw = (assets: bigint, outcome: { shares: bigint } | { revert: string }): FakeCall => ({
    address: VAULT,
    abi: VAULT_V2_ABI,
    functionName: "withdraw",
    args: [assets, OWNER, OWNER],
    ...("shares" in outcome ? { result: outcome.shares } : { revert: outcome.revert }),
  });
  const preview = (assets: bigint, shares: bigint): FakeCall => ({ address: VAULT, abi: VAULT_V2_ABI, functionName: "previewWithdraw", args: [assets], result: shares });

  test("an exact withdrawal that matches its preview is normal evidence", async () => {
    const client = position({ shares: 10n ** 21n, quoted: 1_007_797_674n, extra: [preview(500_000_000n, 496_130_000_000_000_000_000n), withdraw(500_000_000n, { shares: 496_130_000_000_000_000_000n })] });
    const account = await readVaultPosition(client, block, route, await readVault(client, block, route), OWNER);
    const simulated = await simulateWithdrawal(client, block, route, account, 500_000_000n);
    expect(simulated.status).toBe("normal");
    expect(simulated.value).toMatchObject({ assets: 500_000_000n, previewShares: 496_130_000_000_000_000_000n, simulatedShares: 496_130_000_000_000_000_000n });
  });

  test("asking for more than is withdrawable is constrained even before simulation", async () => {
    const client = position({ shares: 10n ** 18n, quoted: 1_007_797n, extra: [preview(2_000_000n, 2n * 10n ** 18n), withdraw(2_000_000n, { revert: "InsufficientShares" })] });
    const account = await readVaultPosition(client, block, route, await readVault(client, block, route), OWNER);
    const simulated = await simulateWithdrawal(client, block, route, account, 2_000_000n);
    expect(simulated.reasons).toEqual(expect.arrayContaining(["withdrawal_constrained", "simulation_reverted"]));
    expect(simulated.value?.simulatedShares).toBeNull();
    expect(simulated.value?.revert).toMatch(/InsufficientShares/);
  });

  test("a withdrawal that burns more shares than previewed conflicts with the preview", async () => {
    const client = position({ shares: 10n ** 21n, quoted: 1_007_797_674n, extra: [preview(500n, 400n), withdraw(500n, { shares: 401n })] });
    const account = await readVaultPosition(client, block, route, await readVault(client, block, route), OWNER);
    expect((await simulateWithdrawal(client, block, route, account, 500n)).reasons).toEqual(["conflict"]);
  });
});
