import { describe, expect, test } from "vitest";
import {
  addressSchema,
  assetIntentSchema,
  baseUnitsSchema,
  canonicalJson,
  guardianActionSchema,
  guardianStateSchema,
  hashSchema,
  marketIdSchema,
  policyV2Schema,
  observe,
  parseDecimalUnits,
  projectedOrRealizedSchema,
  rateSchema,
  vaultIdSchema,
} from "./index.ts";

const address = (digit: string) => `0x${digit.repeat(40)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;

describe("observation status", () => {
  const provenance = {
    kind: "onchain",
    chainId: 4663,
    block: { number: 1n, hash: `0x${"1".repeat(64)}`, timestamp: 1n },
  } as const;

  test("a reason can never leave a value labelled normal", () => {
    expect(observe(5n, provenance).status).toBe("normal");
    expect(observe(5n, provenance, ["stale"]).status).toBe("degraded");
  });

  test("a missing value is unknown and always names why", () => {
    expect(observe(null, provenance)).toMatchObject({ status: "unknown", reasons: ["unreadable"] });
    expect(observe(null, provenance, ["invalid_response"]).reasons).toEqual(["invalid_response"]);
  });

  test("duplicate reasons collapse without losing order", () => {
    expect(observe(1n, provenance, ["stale", "conflict", "stale"]).reasons).toEqual(["stale", "conflict"]);
  });
});

describe("parseDecimalUnits", () => {
  test("keeps every provider digit up to the target scale", () => {
    expect(parseDecimalUnits("1.000566080061092436", 18)).toBe(1_000_566_080_061_092_436n);
    expect(parseDecimalUnits("0.07925257197505986", 18)).toBe(79_252_571_975_059_860n);
    expect(parseDecimalUnits("340.55", 8)).toBe(34_055_000_000n);
  });

  test("reads a JSON float's exponent form and truncates toward zero", () => {
    expect(parseDecimalUnits("2.4215353906509307e-6", 18)).toBe(2_421_535_390_650n);
    expect(parseDecimalUnits("-1.5e-18", 18)).toBe(-1n);
    expect(parseDecimalUnits("1e2", 0)).toBe(100n);
  });

  test("refuses anything that is not a finite decimal", () => {
    for (const bad of ["", "NaN", "Infinity", "1.", ".5", "1e", "0x10", "1,5"]) {
      expect(() => parseDecimalUnits(bad, 18)).toThrow(/not a finite decimal/);
    }
  });
});

const validPolicy = {
  schemaVersion: 2,
  route: {
    chainId: "4663",
    marketId: hash("1"),
    collateralToken: address("a"),
    loanToken: address("b"),
    oracle: address("5"),
    irm: address("6"),
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
  maxOracleDivergenceBps: "100",
  harvestThresholdAssets: "10000000",
  freshness: {
    maxHeadLagSeconds: "120",
    maxFeedAgeSeconds: "86400",
    maxQuoteAgeSeconds: "60",
    maxAssetAgeSeconds: "3600",
    maxCorporateActionsAgeSeconds: "7200",
    maxIndexLagBlocks: "1200",
  },
  triggers: { freezeOnOracleDegraded: true, freezeOnVaultDegraded: true, freezeOnLifecycleDegraded: true },
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

  test("an oracle divergence bound is a fraction of one, never negative or above 100%", () => {
    expect(policyV2Schema.safeParse({ ...validPolicy, maxOracleDivergenceBps: "-1" }).success).toBe(false);
    expect(policyV2Schema.safeParse({ ...validPolicy, maxOracleDivergenceBps: "10001" }).success).toBe(false);
    expect(policyV2Schema.parse({ ...validPolicy, maxOracleDivergenceBps: "0" }).maxOracleDivergenceBps).toBe(0n);
  });

  test("a zero freshness budget would mark every read stale and is rejected", () => {
    expect(policyV2Schema.safeParse({ ...validPolicy, freshness: { ...validPolicy.freshness, maxHeadLagSeconds: "0" } }).success).toBe(false);
  });

  test("the policy route names the full Morpho market parameters, not just its tokens", () => {
    const { oracle: _oracle, ...withoutOracle } = validPolicy.route;
    expect(policyV2Schema.safeParse({ ...validPolicy, route: withoutOracle }).success).toBe(false);
  });
});

describe("canonicalJson", () => {
  test("orders keys so equal content serializes identically", () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe(canonicalJson({ a: { c: null, d: true }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test("keeps bigint exact and distinct from a number or string of the same digits", () => {
    expect(canonicalJson({ v: 2n ** 200n })).toBe(`{"v":{"$bigint":"${(2n ** 200n).toString()}"}}`);
    expect(canonicalJson(1n)).not.toBe(canonicalJson(1));
    expect(canonicalJson(1n)).not.toBe(canonicalJson("1"));
  });

  test("preserves array order", () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });

  test("refuses values that JSON would silently drop or distort", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
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

  test("accepts signed projected carry while keeping realized debt reduction positive", () => {
    expect(projectedOrRealizedSchema.parse({
      kind: "projected",
      annualCarryAssets: "-38000000",
      spreadBps: "-250",
      observedAt: "2026-09-14T09:54:56Z",
    })).toMatchObject({
      annualCarryAssets: -38_000_000n,
      spreadBps: -250n,
    });
    expect(projectedOrRealizedSchema.safeParse({
      kind: "realized",
      transactionHash: hash("f"),
      blockNumber: "62692076",
      debtBeforeAssets: "2000810000",
      debtAfterAssets: "2250830000",
      debtRepaidAssets: "-250020000",
    }).success).toBe(false);
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
