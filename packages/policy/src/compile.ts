import { getAddress, keccak256, stringToHex, zeroAddress } from "viem";
import type { Hex } from "viem";
import { z } from "zod";

import { isRecord } from "@crest/contracts/manifest";
import { addressSchema, assetIntentSchema, canonicalJson, policyV2Schema } from "@crest/domain";
import type { PolicyV2 } from "@crest/domain";

import { policyHashOf } from "./configure.ts";
import type { PolicyConfig } from "./configure.ts";
import type { VerifiedRouteContext } from "./route.ts";

/**
 * Freshness defaults an owner may tighten. Feed age is the Chainlink heartbeat for both route feeds; the
 * others are Crest operating choices: Robinhood documents no cache window for `/assets`.
 */
export const DEFAULT_FRESHNESS = {
  maxHeadLagSeconds: "120",
  maxFeedAgeSeconds: "86400",
  maxQuoteAgeSeconds: "60",
  maxAssetAgeSeconds: "3600",
  maxCorporateActionsAgeSeconds: "7200",
  maxIndexLagBlocks: "1200",
} as const;

const intentEntrySchema = z.strictObject({ asset: addressSchema, intent: assetIntentSchema });
const intentListSchema = z.array(intentEntrySchema).min(1);

export type IntentEntry = z.output<typeof intentEntrySchema>;

export interface CompiledPolicy {
  policy: PolicyV2;
  intents: readonly IntentEntry[];
  route: VerifiedRouteContext;
  /** The struct `configure` receives. */
  config: PolicyConfig;
  /** `keccak256(abi.encode(config))`, matched against the canonical `PolicyConfigured` event. */
  policyHash: Hex;
  /** keccak256 of the canonical typed policy and intents: the persisted policy-version identity. */
  contentHash: Hex;
}

export type CompileResult = { ok: true; policy: CompiledPolicy } | { ok: false; issues: string[] };

const UINT128_MAX = 2n ** 128n - 1n;
const UINT128_FIELDS = [
  "maxCollateralAssets",
  "debtCeilingAssets",
  "maxStrategyAssets",
  "reserveFloorAssets",
  "strategyFloorAssets",
  "maxRepayPerActionAssets",
] as const;

function issueText(issue: z.core.$ZodIssue, prefix?: string): string {
  const path = [prefix, ...issue.path.map(String)].filter((part) => part !== undefined).join(".");
  return path === "" ? issue.message : `${path}: ${issue.message}`;
}

function intentIssues(intents: readonly IntentEntry[], route: VerifiedRouteContext): string[] {
  const issues: string[] = [];
  const counts: Record<string, number> = {};
  for (const { asset } of intents) counts[asset.toLowerCase()] = (counts[asset.toLowerCase()] ?? 0) + 1;
  for (const [asset, count] of Object.entries(counts)) {
    if (count > 1) issues.push(`asset ${asset} has ${count} intents; each asset takes exactly one intent`);
  }

  const borrow = intents.flatMap(({ asset, intent }) => (intent.kind === "PROTECT_AND_BORROW" ? [{ asset, marketId: intent.marketId }] : []));
  const earn = intents.flatMap(({ asset, intent }) => (intent.kind === "EARN_STABLE" ? [{ asset, vaultId: intent.vaultId }] : []));
  const [onlyBorrow] = borrow;
  const [onlyEarn] = earn;
  if (borrow.length !== 1 || onlyBorrow === undefined) {
    issues.push(`exactly one PROTECT_AND_BORROW intent is required; found ${borrow.length}`);
  } else {
    if (onlyBorrow.asset.toLowerCase() !== route.market.collateralToken.toLowerCase()) issues.push("PROTECT_AND_BORROW must name the verified collateral token");
    if (onlyBorrow.marketId.toLowerCase() !== route.marketId.toLowerCase()) issues.push("PROTECT_AND_BORROW must name the verified market");
  }
  if (earn.length !== 1 || onlyEarn === undefined) {
    issues.push(`exactly one EARN_STABLE intent is required; found ${earn.length}`);
  } else {
    if (onlyEarn.asset.toLowerCase() !== route.market.loanToken.toLowerCase()) issues.push("EARN_STABLE must name the verified loan token");
    if (onlyEarn.vaultId.toLowerCase() !== `${route.chainId}:${route.vault}`.toLowerCase()) issues.push("EARN_STABLE must name the verified vault");
  }
  return issues;
}

/**
 * Validates an owner-authored draft against the verified route and compiles it into the exact onchain struct.
 *
 * Only typed, schema-valid input compiles. The route (market, oracle, IRM, LLTV, vault) comes from the verified
 * context and a draft that tries to supply one is rejected. Unknown fields are rejected too, so no draft can
 * carry a Guardian borrowing limit or any other authority the contract does not define.
 */
export function compilePolicy(draft: unknown, route: VerifiedRouteContext): CompileResult {
  if (!isRecord(draft)) return { ok: false, issues: ["policy draft must be an object"] };
  const { intents: rawIntents, route: suppliedRoute, freshness = DEFAULT_FRESHNESS, ...fields } = draft;
  const issues: string[] = [];
  if (suppliedRoute !== undefined) issues.push("route: taken from the verified manifest; a draft may not supply one");

  const parsedPolicy = policyV2Schema.safeParse({
    ...fields,
    freshness,
    route: {
      chainId: String(route.chainId),
      marketId: route.marketId,
      collateralToken: route.market.collateralToken,
      loanToken: route.market.loanToken,
      oracle: route.market.oracle,
      irm: route.market.irm,
      vault: route.vault,
      vaultAsset: route.market.loanToken,
      marketLltvWad: route.market.lltv.toString(),
    },
  });
  const parsedIntents = intentListSchema.safeParse(rawIntents);
  if (!parsedPolicy.success) issues.push(...parsedPolicy.error.issues.map((issue) => issueText(issue)));
  if (!parsedIntents.success) issues.push(...parsedIntents.error.issues.map((issue) => issueText(issue, "intents")));
  if (!parsedPolicy.success || !parsedIntents.success) return { ok: false, issues };

  const policy = parsedPolicy.data;
  const intents = parsedIntents.data;
  issues.push(...intentIssues(intents, route));
  const guardian = getAddress(policy.guardian);
  if (guardian === zeroAddress || guardian === route.owner || guardian === route.account) {
    issues.push("guardian: the Guardian must be a distinct nonzero address, never the owner or the account itself");
  }
  for (const field of UINT128_FIELDS) {
    if (policy[field] > UINT128_MAX) issues.push(`${field}: exceeds the contract's uint128 field`);
  }
  if (issues.length > 0) return { ok: false, issues };

  const config: PolicyConfig = {
    market: route.market,
    yieldVault: route.vault,
    maxCollateralAssets: policy.maxCollateralAssets,
    debtCeilingAssets: policy.debtCeilingAssets,
    maxStrategyAssets: policy.maxStrategyAssets,
    reserveFloorAssets: policy.reserveFloorAssets,
    strategyFloorAssets: policy.strategyFloorAssets,
    maxRepayPerActionAssets: policy.maxRepayPerActionAssets,
    lowerLtvWad: policy.lowerLtvWad,
    targetLtvWad: policy.targetLtvWad,
    upperLtvWad: policy.upperLtvWad,
    criticalLtvWad: policy.criticalLtvWad,
    guardian,
  };
  return {
    ok: true,
    policy: {
      policy,
      intents,
      route,
      config,
      policyHash: policyHashOf(config),
      contentHash: keccak256(stringToHex(canonicalJson({ policy, intents }))),
    },
  };
}
