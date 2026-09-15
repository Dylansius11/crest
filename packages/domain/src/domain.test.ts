import { describe, expect, test } from "vitest";
import {
  addressSchema,
  assetIntentSchema,
  baseUnitsSchema,
  guardianActionSchema,
  guardianStateSchema,
  hashSchema,
  marketIdSchema,
  policyV2Schema,
  projectedOrRealizedSchema,
  rateSchema,
  vaultIdSchema,
} from "./index.ts";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;

const validPolicy = {
  schemaVersion: 2,
  route: {
    chainId: "4663",
    marketId: hash("1"),
    collateralToken: address("a"),
    loanToken: address("b"),
    vault: address("c"),
    vaultAsset: address("b"),
    marketLltvWad: "625000000000000000",
  },
  maxCollateralAssets: "10000000000000000000",
  debtCeilingAssets: "2000000000",
  maxStrategyAssets: "1500000000",
  reserveFloorAssets: "250000000",
  strategyFloorAssets: "500000000",
  maxRepayPerActionAssets: "250000000",
  lowerLtvWad: "300000000000000000",
  targetLtvWad: "350000000000000000",
  upperLtvWad: "420000000000000000",
  criticalLtvWad: "500000000000000000",
  minimumNetSpreadBps: "100",
  guardian: address("d"),
} as const;

describe("validated identities", () => {
  test("rejects malformed addresses and hashes", () => {
    expect(addressSchema.safeParse(address("a")).success).toBe(true);
    expect(hashSchema.safeParse(hash("b")).success).toBe(true);
    expect(addressSchema.safeParse("0x1234").success).toBe(false);
    expect(hashSchema.safeParse(`${hash("b")}00`).success).toBe(false);
  });

  test("keeps market and vault identities distinct", () => {
    expect(marketIdSchema.parse(hash("1"))).toBe(hash("1"));
    expect(vaultIdSchema.parse(`4663:${address("2")}`)).toBe(`4663:${address("2")}`);
    expect(vaultIdSchema.safeParse(hash("1")).success).toBe(false);
  });
});

describe("lossless financial boundaries", () => {
  test("restores decimal strings exactly to bigint and rejects floats or numbers", () => {
    const value = "999999999999999999999999999999999999999999999999999999999999999999999999999999";
    expect(baseUnitsSchema.parse(value)).toBe(BigInt(value));
    expect(baseUnitsSchema.safeParse("1.5").success).toBe(false);
    expect(baseUnitsSchema.safeParse(1).success).toBe(false);
    expect(baseUnitsSchema.safeParse("-1").success).toBe(false);
  });

  test("requires an explicit positive rate scale and convention", () => {
    const input = {
      value: "36466465324746133",
      scale: "1000000000000000000",
      convention: "apy-compounded",
      source: "https://api.morpho.org/",
      observedAt: "2026-09-14T09:54:56Z",
      status: "normal",
    } as const;
    const rate = rateSchema.parse(input);
    expect(rate.value).toBe(36_466_465_324_746_133n);
    expect(rate.scale).toBe(1_000_000_000_000_000_000n);
    expect(rateSchema.safeParse({ ...input, scale: "0" }).success).toBe(false);
  });
});

describe("asset intent", () => {
  test("defines every supported and explicitly unsupported intent", () => {
    expect(assetIntentSchema.parse({ kind: "KEEP" }).kind).toBe("KEEP");
    expect(assetIntentSchema.parse({ kind: "PROTECT_AND_BORROW", marketId: hash("1") }).kind).toBe("PROTECT_AND_BORROW");
    expect(assetIntentSchema.parse({ kind: "EARN_STABLE", vaultId: `4663:${address("2")}` }).kind).toBe("EARN_STABLE");
    expect(assetIntentSchema.parse({ kind: "EARN_ASSET", availability: "post_mvp" }).kind).toBe("EARN_ASSET");
    expect(assetIntentSchema.parse({ kind: "UNSUPPORTED", reasonCodes: ["NO_VERIFIED_ROUTE"] }).kind).toBe("UNSUPPORTED");
  });

  test("does not allow KEEP or UNSUPPORTED intent to carry a transaction", () => {
    expect(assetIntentSchema.safeParse({ kind: "KEEP", preparedCalldata: "0x12" }).success).toBe(false);
    expect(assetIntentSchema.safeParse({ kind: "UNSUPPORTED", reasonCodes: ["NO_ROUTE"], preparedCalldata: "0x12" }).success).toBe(false);
  });
});

describe("policy boundaries", () => {
  test("parses a coherent fixed route and ordered LTV policy", () => {
    const policy = policyV2Schema.parse(validPolicy);
    expect(policy.route.chainId).toBe(4663n);
    expect(policy.debtCeilingAssets).toBe(2_000_000_000n);
  });

  test("rejects mismatched loan and vault assets", () => {
    expect(policyV2Schema.safeParse({
      ...validPolicy,
      route: { ...validPolicy.route, vaultAsset: address("e") },
    }).success).toBe(false);
  });

  test("rejects invalid LTV ordering and a critical threshold at the Morpho LLTV", () => {
    expect(policyV2Schema.safeParse({ ...validPolicy, targetLtvWad: validPolicy.lowerLtvWad }).success).toBe(false);
    expect(policyV2Schema.safeParse({ ...validPolicy, criticalLtvWad: validPolicy.route.marketLltvWad }).success).toBe(false);
  });
});

describe("Guardian and evidence boundaries", () => {
  test("defines the seven deterministic Guardian states", () => {
    for (const state of ["NORMAL", "HARVESTABLE", "UPSIZE_AVAILABLE", "PROTECT", "EXIT_YIELD", "CRITICAL", "DEGRADED"] as const) {
      expect(guardianStateSchema.parse(state)).toBe(state);
    }
  });

  test("permits only freeze and own-debt repayment selectors", () => {
    expect(guardianActionSchema.parse({ kind: "freeze", selector: "freezeBorrowing()" }).kind).toBe("freeze");
    expect(guardianActionSchema.parse({ kind: "repay_reserve", selector: "repayFromReserve(uint256)", requestedAssets: "1" })).toEqual({
      kind: "repay_reserve",
      selector: "repayFromReserve(uint256)",
      requestedAssets: 1n,
    });
    expect(guardianActionSchema.safeParse({ kind: "borrow", selector: "borrowAndDeploy(uint256,uint256)", requestedAssets: "1" }).success).toBe(false);
    expect(guardianActionSchema.safeParse({ kind: "repay_strategy", selector: "repayFromStrategy(uint256)", requestedAssets: "0" }).success).toBe(false);
  });

  test("keeps projected carry separate from canonical realized debt reduction", () => {
    expect(projectedOrRealizedSchema.parse({
      kind: "projected",
      annualCarryAssets: "38000000",
      spreadBps: "250",
      observedAt: "2026-09-14T09:54:56Z",
    })).toEqual({
      kind: "projected",
      annualCarryAssets: 38_000_000n,
      spreadBps: 250n,
      observedAt: "2026-09-14T09:54:56Z",
    });
    expect(projectedOrRealizedSchema.safeParse({
      kind: "projected",
      annualCarryAssets: "38000000",
      spreadBps: "250",
      observedAt: "2026-09-14T09:54:56Z",
      debtRepaidAssets: "250000000",
    }).success).toBe(false);
    expect(projectedOrRealizedSchema.parse({
      kind: "realized",
      transactionHash: hash("f"),
      blockNumber: "62692076",
      debtBeforeAssets: "2000810000",
      debtAfterAssets: "1750790000",
      debtRepaidAssets: "250020000",
    })).toEqual({
      kind: "realized",
      transactionHash: hash("f"),
      blockNumber: 62_692_076n,
      debtBeforeAssets: 2_000_810_000n,
      debtAfterAssets: 1_750_790_000n,
      debtRepaidAssets: 250_020_000n,
    });
  });
});
