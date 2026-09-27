import { fileURLToPath } from "node:url";

import { decodeFunctionData, getAddress, keccak256, sliceHex } from "viem";
import type { Abi } from "viem";
import { describe, expect, test } from "vitest";

import { crestAccount } from "@crest/contracts";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { marketIdOf } from "@crest/morpho";

import { compilePolicy, DEFAULT_FRESHNESS, routeContextOf, toConfigurationCall } from "./index.ts";
import type { CompiledPolicy } from "./index.ts";

const manifest = await loadDeploymentManifest(fileURLToPath(new URL("../../../config/deployment-manifest.json", import.meta.url)));
const ACCOUNT = getAddress(`0x${"a1".repeat(20)}`);
const OWNER = getAddress(`0x${"b2".repeat(20)}`);
const GUARDIAN = getAddress(`0x${"c3".repeat(20)}`);
const OTHER = getAddress(`0x${"d4".repeat(20)}`);
const route = routeContextOf(manifest, { account: ACCOUNT, owner: OWNER });

/** Illustrative owner inputs for a 10 AAPL position; every address comes from the reviewed manifest. */
const draft = {
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

function compiled(input: unknown = draft): CompiledPolicy {
  const result = compilePolicy(input, route);
  if (!result.ok) throw new Error(result.issues.join("; "));
  return result.policy;
}

function issuesOf(input: unknown): string[] {
  const result = compilePolicy(input, route);
  return result.ok ? [] : result.issues;
}

describe("verified route context", () => {
  test("binds the reviewed manifest: exact market parameters, decimals, and feeds", () => {
    expect(marketIdOf(route.market)).toBe(route.marketId);
    expect(route.market.lltv).toBe(625_000_000_000_000_000n);
    expect(route.tokens).toEqual({ collateralDecimals: 18, loanDecimals: 6 });
    expect(route.feeds.collateral).toBe(getAddress(manifest.contracts.collateralFeed?.address ?? ""));
    expect(route.vault).toBe(getAddress(manifest.vault.address));
  });

  test("refuses a manifest whose gate did not qualify the full market-and-vault route", () => {
    expect(() => routeContextOf({ ...manifest, gate: { ...manifest.gate, outcome: "reserve_only" } }, { account: ACCOUNT, owner: OWNER })).toThrow(/full_route/);
  });

  test("refuses a manifest whose market id does not derive from its parameters", () => {
    expect(() => routeContextOf({ ...manifest, market: { ...manifest.market, lltv: "860000000000000000" } }, { account: ACCOUNT, owner: OWNER })).toThrow(/market id/);
  });
});

describe("compilePolicy", () => {
  test("takes the route only from the verified context and fills documented freshness defaults", () => {
    const policy = compiled();
    expect(policy.policy.route.marketId).toBe(route.marketId);
    expect(policy.policy.route.oracle).toBe(route.market.oracle);
    expect(policy.policy.freshness.maxFeedAgeSeconds).toBe(BigInt(DEFAULT_FRESHNESS.maxFeedAgeSeconds));
    expect(issuesOf({ ...draft, route: {} }).join()).toMatch(/route/);
  });

  test("an owner-tightened freshness budget is kept", () => {
    expect(compiled({ ...draft, freshness: { ...DEFAULT_FRESHNESS, maxHeadLagSeconds: "30" } }).policy.freshness.maxHeadLagSeconds).toBe(30n);
  });

  test("the same content compiles to the same content hash regardless of key order", () => {
    const reordered = Object.fromEntries(Object.entries(draft).reverse());
    expect(compiled(reordered).contentHash).toBe(compiled().contentHash);
    expect(compiled({ ...draft, debtCeilingAssets: "1400000000" }).contentHash).not.toBe(compiled().contentHash);
  });
});

describe("asset intents", () => {
  const [borrow, earn] = draft.intents;

  test("requires exactly one borrow intent on the verified market and one stable-earn intent on the verified vault", () => {
    expect(issuesOf({ ...draft, intents: [borrow] }).join()).toMatch(/EARN_STABLE/);
    expect(issuesOf({ ...draft, intents: [earn] }).join()).toMatch(/PROTECT_AND_BORROW/);
    expect(issuesOf({ ...draft, intents: [borrow, borrow, earn] }).join()).toMatch(/exactly one/);
  });

  test("an executable intent naming another market, vault, or asset is rejected", () => {
    const otherMarket = { ...borrow, intent: { kind: "PROTECT_AND_BORROW", marketId: `0x${"1".repeat(64)}` } };
    const otherVault = { ...earn, intent: { kind: "EARN_STABLE", vaultId: `${route.chainId}:${OTHER}` } };
    const otherAsset = { ...borrow, asset: OTHER };
    expect(issuesOf({ ...draft, intents: [otherMarket, earn] }).join()).toMatch(/market/);
    expect(issuesOf({ ...draft, intents: [borrow, otherVault] }).join()).toMatch(/vault/);
    expect(issuesOf({ ...draft, intents: [otherAsset, earn] }).join()).toMatch(/collateral/);
  });

  test("non-executable intents may describe other wallet assets but never the route's own tokens", () => {
    const keepOther = { asset: OTHER, intent: { kind: "KEEP" } };
    expect(compiled({ ...draft, intents: [borrow, earn, keepOther] }).intents).toHaveLength(3);
    const unsupportedCollateral = { asset: route.market.collateralToken, intent: { kind: "UNSUPPORTED", reasonCodes: ["no_market"] } };
    expect(issuesOf({ ...draft, intents: [borrow, earn, unsupportedCollateral] }).join()).toMatch(/one intent/);
  });
});

describe("LTV ordering, caps, and floors", () => {
  test("critical LTV at the verified Morpho LLTV is rejected", () => {
    expect(issuesOf({ ...draft, criticalLtvWad: route.market.lltv.toString() }).length).toBeGreaterThan(0);
  });

  test("thresholds out of order are rejected", () => {
    expect(issuesOf({ ...draft, upperLtvWad: draft.targetLtvWad }).length).toBeGreaterThan(0);
  });

  test("a strategy floor above the strategy cap is rejected", () => {
    expect(issuesOf({ ...draft, strategyFloorAssets: "1500000001" }).join()).toMatch(/strategy floor/);
  });

  test("an amount the contract's uint128 field cannot hold is rejected before encoding", () => {
    expect(issuesOf({ ...draft, debtCeilingAssets: (2n ** 128n).toString() }).join()).toMatch(/uint128/);
  });
});

describe("Guardian authority", () => {
  test("a draft cannot grant the Guardian any borrowing field", () => {
    expect(issuesOf({ ...draft, guardianBorrowCapAssets: "1" }).length).toBeGreaterThan(0);
  });

  test("the Guardian cannot be the owner, the account itself, or the zero address", () => {
    expect(issuesOf({ ...draft, guardian: OWNER }).join()).toMatch(/Guardian/);
    expect(issuesOf({ ...draft, guardian: ACCOUNT }).join()).toMatch(/Guardian/);
    expect(issuesOf({ ...draft, guardian: `0x${"0".repeat(40)}` }).join()).toMatch(/Guardian/);
  });
});

describe("toConfigurationCall", () => {
  const policy = compiled();
  const call = toConfigurationCall(policy);

  test("prepares an owner-signed configure call to the account and nothing else", () => {
    expect(call).toMatchObject({ chainId: 4663, from: OWNER, to: ACCOUNT, value: 0n, functionName: "configure" });
    expect(call.selector).toBe(`0x${crestAccount.methodIdentifiers["configure(((address,address,address,address,uint256),address,uint128,uint128,uint128,uint128,uint128,uint128,uint64,uint64,uint64,uint64,address))"]}`);
  });

  test("calldata decodes against the generated contract ABI to exactly the compiled policy", () => {
    const decoded = decodeFunctionData({ abi: crestAccount.abi as unknown as Abi, data: call.data });
    expect(decoded.functionName).toBe("configure");
    expect(decoded.args?.[0]).toEqual({
      market: {
        loanToken: route.market.loanToken,
        collateralToken: route.market.collateralToken,
        oracle: route.market.oracle,
        irm: route.market.irm,
        lltv: route.market.lltv,
      },
      yieldVault: route.vault,
      maxCollateralAssets: 10_000_000_000_000_000_000n,
      debtCeilingAssets: 1_500_000_000n,
      maxStrategyAssets: 1_500_000_000n,
      reserveFloorAssets: 50_000_000n,
      strategyFloorAssets: 0n,
      maxRepayPerActionAssets: 500_000_000n,
      lowerLtvWad: 300_000_000_000_000_000n,
      targetLtvWad: 350_000_000_000_000_000n,
      upperLtvWad: 420_000_000_000_000_000n,
      criticalLtvWad: 500_000_000_000_000_000n,
      guardian: GUARDIAN,
    });
  });

  test("the policy hash is keccak256 of the struct encoding the contract hashes into PolicyConfigured", () => {
    // `configure` takes one static tuple, so its calldata after the selector is exactly `abi.encode(_policy)`.
    expect(call.policyHash).toBe(keccak256(sliceHex(call.data, 4)));
  });
});
