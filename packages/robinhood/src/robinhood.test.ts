import { describe, expect, test } from "vitest";

import { fakeChain } from "@crest/chain/testing";
import type { Fetch } from "@crest/domain";

import assets from "./fixtures/assets.json" with { type: "json" };
import corporateActions from "./fixtures/corporate-actions.json" with { type: "json" };
import pricesAapl from "./fixtures/prices-aapl.json" with { type: "json" };
import {
  assessLifecycle,
  classifyMarketOracle,
  fetchCorporateActions,
  fetchQuote,
  fetchStockTokenAsset,
  readStockToken,
  STOCK_TOKEN_ABI,
  stockTokenValues,
} from "./index.ts";

const BASE = "https://api.robinhood.com/rhj";
const AAPL = { chainId: 4663, address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" } as const;
const AAPL_UID = "0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649";
const LIVE_MULTIPLIER = 1_000_566_080_061_092_436n;
const block = { number: 70_212_238n, hash: `0x${"ab".repeat(32)}`, timestamp: 1_790_136_140n } as const;
const recordedAt = (iso: string) => () => new Date(iso);
/** A real recorded dividend row, re-pointed at AAPL where a test needs an action for this token. */
const recordedAction = corporateActions.body.corpActions[0] as (typeof corporateActions.body.corpActions)[number];

interface Recording {
  recordedFrom: string;
  recordedAt: string;
  body: unknown;
  status?: number;
}

function replay(...recordings: Recording[]): Fetch {
  return async (url) => {
    const recording = recordings.find((entry) => entry.recordedFrom === url);
    if (recording === undefined) return new Response("not recorded", { status: 404 });
    return new Response(JSON.stringify(recording.body), { status: recording.status ?? 200 });
  };
}

function token(overrides: { uid?: string; multiplier?: bigint; next?: bigint; effectiveAt?: bigint; paused?: boolean } = {}) {
  return fakeChain({
    block,
    calls: [
      { address: AAPL.address, abi: STOCK_TOKEN_ABI, functionName: "uid", result: overrides.uid ?? AAPL_UID },
      { address: AAPL.address, abi: STOCK_TOKEN_ABI, functionName: "uiMultiplier", result: overrides.multiplier ?? LIVE_MULTIPLIER },
      { address: AAPL.address, abi: STOCK_TOKEN_ABI, functionName: "newUIMultiplier", result: overrides.next ?? LIVE_MULTIPLIER },
      { address: AAPL.address, abi: STOCK_TOKEN_ABI, functionName: "effectiveAt", result: overrides.effectiveAt ?? 1_786_720_366n },
      { address: AAPL.address, abi: STOCK_TOKEN_ABI, functionName: "oraclePaused", result: overrides.paused ?? false },
      { address: AAPL.address, abi: STOCK_TOKEN_ABI, functionName: "decimals", result: 18 },
    ],
  });
}

describe("REST lifecycle adapters", () => {
  test("identity is the (chain, address) deployment, never the ticker", async () => {
    const asset = await fetchStockTokenAsset(replay(assets), BASE, AAPL, { now: recordedAt(assets.recordedAt) });
    expect(asset.status).toBe("normal");
    expect(asset.value).toEqual({
      uid: AAPL_UID,
      symbol: "AAPL",
      currentMultiplierWad: LIVE_MULTIPLIER,
      pendingMultiplierWad: null,
      pendingEffectiveAt: null,
      status: "ASSET_STATUS_ACTIVE",
    });

    const renamed = { ...assets, body: { assets: assets.body.assets.map((entry) => ({ ...entry, tokenSymbol: "AAPL" })) } };
    const crmAsAapl = await fetchStockTokenAsset(replay(renamed), BASE, { chainId: 4663, address: "0xd95B44124e475743a7589e68F3D74008A5536D44" }, { now: recordedAt(assets.recordedAt) });
    expect(crmAsAapl.value?.uid).not.toBe(AAPL_UID);
  });

  test("a token Robinhood does not list is unknown, not assumed healthy", async () => {
    const missing = await fetchStockTokenAsset(replay(assets), BASE, { chainId: 4663, address: "0x0000000000000000000000000000000000000001" }, { now: recordedAt(assets.recordedAt) });
    expect(missing).toMatchObject({ status: "unknown", reasons: ["identity_mismatch"] });
  });

  test("the quote keeps provider generation time and its documented 15 second cache window", async () => {
    const quote = await fetchQuote(replay(pricesAapl), BASE, "AAPL", AAPL, { now: recordedAt(pricesAapl.recordedAt) });
    expect(quote.status).toBe("normal");
    expect(quote.value).toMatchObject({ isTradingHalt: false, bid: "340.5", ask: "340.55", currency: "USD" });
    expect(quote.provenance).toMatchObject({ generatedAt: "2026-09-23T03:58:51.013367223Z", fetchedAt: "2026-09-23T03:58:54.000Z", expiresAt: "2026-09-23T03:59:09.000Z" });
  });

  test("a quote whose deployments do not include the token is an identity mismatch", async () => {
    const quote = await fetchQuote(replay(pricesAapl), BASE, "AAPL", { chainId: 4663, address: "0x0000000000000000000000000000000000000002" }, { now: recordedAt(pricesAapl.recordedAt) });
    expect(quote.reasons).toContain("identity_mismatch");
  });

  test("corporate actions are filtered to the exact deployment", async () => {
    const actions = await fetchCorporateActions(replay(corporateActions), BASE, AAPL, { now: recordedAt(corporateActions.recordedAt) });
    expect(actions).toMatchObject({ status: "normal", value: [] });
    expect(actions.provenance).toMatchObject({ expiresAt: "2026-09-23T04:58:54.000Z" });
  });

  test("an unknown action type is kept, not rejected, so a new lifecycle event is never silently dropped", async () => {
    const first = recordedAction;
    const future = { ...first, type: "CORPORATE_ACTION_TYPE_SPIN_OFF", deployments: [{ contractAddress: AAPL.address, chainId: 4663 }], details: { spinOff: {} } };
    const actions = await fetchCorporateActions(replay({ ...corporateActions, body: { corpActions: [future] } }), BASE, AAPL, { now: recordedAt(corporateActions.recordedAt) });
    expect(actions.value?.map((action) => action.type)).toEqual(["CORPORATE_ACTION_TYPE_SPIN_OFF"]);
  });
});

describe("onchain Stock Token state", () => {
  test("reads uid, multiplier, schedule, and the advisory pause at the pinned block", async () => {
    const state = await readStockToken(token(), block, AAPL.address);
    expect(state.status).toBe("normal");
    expect(state.value).toEqual({ uid: AAPL_UID, uiMultiplierWad: LIVE_MULTIPLIER, newUIMultiplierWad: LIVE_MULTIPLIER, effectiveAt: 1_786_720_366n, oraclePaused: false, decimals: 18 });
  });

  test("a scheduled multiplier change and a paused oracle both tighten", async () => {
    const pending = await readStockToken(token({ next: 4n * 10n ** 18n, effectiveAt: block.timestamp + 3_600n }), block, AAPL.address);
    expect(pending.reasons).toEqual(["multiplier_pending"]);
    const paused = await readStockToken(token({ paused: true }), block, AAPL.address);
    expect(paused.reasons).toEqual(["oracle_paused"]);
  });
});

describe("assessLifecycle", () => {
  const now = recordedAt("2026-09-23T03:58:56Z");
  const budgets = { assetMaxAgeSeconds: 3_600, quoteMaxAgeSeconds: 60, actionsMaxAgeSeconds: 7_200 };

  async function inputs(options: { quote?: Recording; tokenState?: Parameters<typeof token>[0]; actions?: Recording } = {}) {
    return {
      token: await readStockToken(token(options.tokenState), block, AAPL.address),
      asset: await fetchStockTokenAsset(replay(assets), BASE, AAPL, { now: recordedAt(assets.recordedAt) }),
      quote: await fetchQuote(replay(options.quote ?? pricesAapl), BASE, "AAPL", AAPL, { now: recordedAt(pricesAapl.recordedAt) }),
      actions: await fetchCorporateActions(replay(options.actions ?? corporateActions), BASE, AAPL, { now: recordedAt(corporateActions.recordedAt) }),
    };
  }

  test("agreeing live sources are normal and keep every input attributable", async () => {
    const assessment = assessLifecycle(await inputs(), { now, ...budgets });
    expect(assessment).toMatchObject({ status: "normal", reasons: [] });
    expect(assessment.inputs.quote.provenance.kind).toBe("http");
    expect(assessment.inputs.token.provenance.kind).toBe("onchain");
  });

  test("REST and onchain multipliers that disagree conflict, and the onchain value is the one kept", async () => {
    const assessment = assessLifecycle(await inputs({ tokenState: { multiplier: LIVE_MULTIPLIER + 1n, next: LIVE_MULTIPLIER + 1n } }), { now, ...budgets });
    expect(assessment.reasons).toEqual(["conflict"]);
    expect(assessment.multiplierWad).toBe(LIVE_MULTIPLIER + 1n);
  });

  test("a REST record for a different onchain uid is an identity mismatch", async () => {
    expect(assessLifecycle(await inputs({ tokenState: { uid: `0x${"22".repeat(32)}` } }), { now, ...budgets }).reasons).toEqual(["identity_mismatch"]);
  });

  test("a trading halt and an in-progress action for this token tighten", async () => {
    const halted = { ...pricesAapl, body: { quotes: pricesAapl.body.quotes.map((quote) => ({ ...quote, isTradingHalt: true })) } };
    const first = recordedAction;
    const inProgress = { ...corporateActions, body: { corpActions: [{ ...first, deployments: [{ contractAddress: AAPL.address, chainId: 4663 }] }] } };
    const assessment = assessLifecycle(await inputs({ quote: halted, actions: inProgress }), { now, ...budgets });
    expect(assessment.reasons).toEqual(["trading_halt", "corporate_action_in_progress"]);
  });

  test("a quote older than budget is stale even though Robinhood served it", async () => {
    const later = recordedAt("2026-09-23T04:00:00Z");
    expect(assessLifecycle(await inputs(), { now: later, ...budgets }).reasons).toEqual(["stale"]);
  });

  test("a missing REST source degrades the assessment instead of passing it", async () => {
    const all = await inputs();
    const unreachable = await fetchQuote(replay(), BASE, "AAPL", AAPL, { now });
    expect(assessLifecycle({ ...all, quote: unreachable }, { now, ...budgets })).toMatchObject({ status: "degraded", reasons: ["unreadable"] });
  });

  test("without an onchain token read the lifecycle is unknown", async () => {
    const all = await inputs();
    const unreadable = await readStockToken(fakeChain({ block }), block, AAPL.address);
    expect(assessLifecycle({ ...all, token: unreadable }, { now, ...budgets }).status).toBe("unknown");
  });
});

describe("multiplier double adjustment", () => {
  const feed = { answer: 33_974_221_248n, decimals: 8 };

  test("a feed price already includes the multiplier, so token value never scales with it again", () => {
    const one = stockTokenValues({ rawBalance: 10n ** 18n, uiMultiplierWad: 10n ** 18n, feed });
    const split = stockTokenValues({ rawBalance: 10n ** 18n, uiMultiplierWad: 4n * 10n ** 18n, feed });
    expect(split.feedValue).toBe(one.feedValue);
    expect(split.underlyingShares).toBe(4n * one.underlyingShares);
    expect(one).toEqual({ rawBalance: 10n ** 18n, underlyingShares: 10n ** 18n, feedValue: 33_974_221_248n, feedDecimals: 8 });
  });

  test("detects that the live Morpho market oracle multiplies the feed by uiMultiplier", () => {
    // Live reads at Robinhood block 70212238: market oracle price(), AAPL/USD and USDG/USD feeds, AAPL uiMultiplier.
    const live = {
      oraclePrice: 339_917_537_895_501_582_692_865_356n,
      collateralAnswer: 33_974_221_248n,
      loanAnswer: 100_005_000n,
      uiMultiplierWad: LIVE_MULTIPLIER,
      decimals: { collateralToken: 18, loanToken: 6, collateralFeed: 8, loanFeed: 8 },
    };
    expect(classifyMarketOracle(live)).toBe("feed_times_multiplier");
    expect(classifyMarketOracle({ ...live, oraclePrice: 339_725_226_218_689_065_546_722_663n })).toBe("feed_only");
    expect(classifyMarketOracle({ ...live, oraclePrice: 1n })).toBe("unexplained");
    expect(classifyMarketOracle({ ...live, uiMultiplierWad: 10n ** 18n, oraclePrice: 339_725_226_218_689_065_546_722_663n })).toBe("indistinguishable");
  });
});
