import { mkdir, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { parseArgs } from "node:util";

import { getAddress } from "viem";
import type { Address } from "viem";

import { createRobinhoodClient, onchainAt, pinBlock, readCodeHash, readFeed, readMarketOraclePrice } from "@crest/chain";
import type { FeedRound } from "@crest/chain";
import { loadDeploymentManifest } from "@crest/contracts/manifest/file";
import { observe } from "@crest/domain";
import type { Fetch, Observation, ReasonCode } from "@crest/domain";
import { morphoRouteOf, readMarket, readPosition } from "@crest/morpho";
import {
  comparability,
  fetchMarketBorrowApy,
  fetchMarketIncentives,
  fetchVaultIncentives,
  fetchVaultNativeApy,
  instantBorrowRate,
  vaultFees,
} from "@crest/rates";
import {
  assessLifecycle,
  classifyMarketOracle,
  fetchCorporateActions,
  fetchQuote,
  fetchStockTokenAsset,
  readStockToken,
  stockTokenValues,
} from "@crest/robinhood";
import { readVault, readVaultPosition, simulateWithdrawal, vaultRouteOf } from "@crest/vault";

/**
 * Read-only adapter smoke against the active deployment manifest at one pinned Robinhood block.
 *
 * Nothing here signs or sends. Every adapter runs once against live state and its full observation, including
 * provenance and reasons, is written to `--out`. Exits non-zero when any identity or route check fails, so a
 * drifted route can never produce a passing smoke.
 *
 *   node scripts/smoke-adapters.ts --rpc <url> --borrower <address> --vault-holder <address> [--doh]
 *
 * `--borrower` and `--vault-holder` are real accounts discovered off-chain; the adapters verify their
 * positions onchain at the pinned block. `--doh` resolves HTTPS hosts through Cloudflare DNS-over-HTTPS and
 * is dev-only tooling for networks that hijack DNS; it changes transport, never the requested URL or TLS name.
 */

const { values: args } = parseArgs({
  options: {
    rpc: { type: "string" },
    borrower: { type: "string" },
    "vault-holder": { type: "string" },
    out: { type: "string", default: ".tmp/adapter-smoke.json" },
    doh: { type: "boolean", default: false },
  },
});

const rpcUrl = args.rpc ?? process.env.ROBINHOOD_CHAIN_RPC_URL;
if (!args.borrower || !args["vault-holder"]) throw new Error("--borrower and --vault-holder are required; the smoke never invents accounts");
const borrower = getAddress(args.borrower);
const vaultHolder = getAddress(args["vault-holder"]);
const ROBINHOOD_API = process.env.ROBINHOOD_API_BASE_URL ?? "https://api.robinhood.com/rhj";
/** The selected manifest's feeds may be unavailable; an absent loan feed degrades rather than being invented. */
const FEED_HEARTBEAT_SECONDS = 86_400n;

async function resolveOverDoh(host: string): Promise<string> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${host}&type=A`, { headers: { accept: "application/dns-json" } });
  const body: unknown = await response.json();
  const answers: unknown[] = typeof body === "object" && body !== null && "Answer" in body && Array.isArray(body.Answer) ? body.Answer : [];
  for (const answer of answers) {
    if (typeof answer === "object" && answer !== null && "type" in answer && answer.type === 1 && "data" in answer && typeof answer.data === "string") return answer.data;
  }
  throw new Error(`DoH returned no A record for ${host}`);
}

/** Same URL, same TLS server name, only the IP lookup differs. */
const dohFetch: Fetch = async (url, init) => {
  const target = new URL(url);
  const ip = await resolveOverDoh(target.hostname);
  const done = Promise.withResolvers<Response>();
  const outgoing = httpsRequest(
    target,
    {
      method: init?.method ?? "GET",
      headers: { "user-agent": "crest-adapter-smoke", ...Object.fromEntries(new Headers(init?.headers)) },
      lookup: (_host, options, callback) => (options.all ? callback(null, [{ address: ip, family: 4 }]) : callback(null, ip, 4)),
    },
    (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => done.resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502 })));
    },
  );
  outgoing.on("error", done.reject);
  outgoing.end(typeof init?.body === "string" ? init.body : undefined);
  return done.promise;
};

const fetchFn: Fetch = args.doh ? dohFetch : (url, init) => fetch(url, init);
const now = () => new Date();

const manifest = await loadDeploymentManifest();
const client = createRobinhoodClient(rpcUrl, manifest.network.chainId);
const pinned = await pinBlock(client, {
  nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
  maxHeadLagSeconds: 120n,
  expectedChainId: manifest.network.chainId,
});
if (pinned.value === null) throw new Error("could not pin a Robinhood block");
const { block } = pinned.value;
const reference = { headBlock: block.number, maxIndexLagBlocks: 1_200n };

const morphoRoute = morphoRouteOf(manifest);
const vaultRoute = vaultRouteOf(manifest);
const contract = (name: string): Address => {
  const entry = manifest.contracts[name];
  if (entry === undefined) throw new Error(`manifest has no ${name}`);
  return getAddress(entry.address);
};

const codeHashes = Object.fromEntries(
  await Promise.all(
    Object.entries(manifest.contracts).map(async ([name, entry]) => [name, await readCodeHash(client, block, getAddress(entry.address), entry.codeHash as `0x${string}`)] as const),
  ),
);

const market = await readMarket(client, block, morphoRoute);
const position = market.value === null ? null : await readPosition(client, block, morphoRoute, market.value, borrower);
const [oraclePrice, collateralFeed, loanFeed, stockToken] = await Promise.all([
  readMarketOraclePrice(client, block, morphoRoute.params.oracle),
  readFeed(client, block, contract("collateralFeed"), FEED_HEARTBEAT_SECONDS),
  manifest.contracts.loanFeed === undefined
    ? Promise.resolve(observe<FeedRound>(null, onchainAt(block, manifest.network.chainId)))
    : readFeed(client, block, contract("loanFeed"), FEED_HEARTBEAT_SECONDS),
  readStockToken(client, block, morphoRoute.params.collateralToken),
]);

const vault = await readVault(client, block, vaultRoute);
const holder = await readVaultPosition(client, block, vaultRoute, vault, vaultHolder);
const probeAssets = 1_000_000n; // 1 USDG
const withdrawal = await simulateWithdrawal(client, block, vaultRoute, holder, probeAssets);

const marketRef = { chainId: manifest.network.chainId, marketId: morphoRoute.marketId };
const vaultRef = { chainId: manifest.network.chainId, vault: vaultRoute.vault };
const [borrowDay, vaultDay, vaultSixHours, vaultIncentives, marketIncentives] = await Promise.all([
  fetchMarketBorrowApy(fetchFn, marketRef, "24h", { now, reference }),
  fetchVaultNativeApy(fetchFn, vaultRef, "one_day", { now, reference }),
  fetchVaultNativeApy(fetchFn, vaultRef, "six_hours", { now, reference }),
  fetchVaultIncentives(fetchFn, vaultRef, { now }),
  fetchMarketIncentives(fetchFn, marketRef, { now }),
]);
const instantBorrow = instantBorrowRate(market);

const tokenRef = { chainId: manifest.network.chainId, address: morphoRoute.params.collateralToken };
const asset = await fetchStockTokenAsset(fetchFn, ROBINHOOD_API, tokenRef, { now });
const [quote, actions] = await Promise.all([
  fetchQuote(fetchFn, ROBINHOOD_API, asset.value?.symbol ?? "AAPL", tokenRef, { now }),
  fetchCorporateActions(fetchFn, ROBINHOOD_API, tokenRef, { now }),
]);
const lifecycle = assessLifecycle(
  { token: stockToken, asset, quote, actions },
  { now, assetMaxAgeSeconds: 3_600, quoteMaxAgeSeconds: 60, actionsMaxAgeSeconds: 7_200 },
);

const oracleComposition = oraclePrice.value !== null && collateralFeed.value !== null && loanFeed.value !== null && stockToken.value !== null
  ? classifyMarketOracle({
    oraclePrice: oraclePrice.value,
    collateralAnswer: collateralFeed.value.answer,
    loanAnswer: loanFeed.value.answer,
    uiMultiplierWad: stockToken.value.uiMultiplierWad,
    decimals: { collateralToken: 18, loanToken: 6, collateralFeed: collateralFeed.value.decimals, loanFeed: loanFeed.value.decimals },
  })
  : "unexplained";
const oneToken = stockToken.value !== null && collateralFeed.value !== null
  ? stockTokenValues({ rawBalance: 10n ** 18n, uiMultiplierWad: stockToken.value.uiMultiplierWad, feed: collateralFeed.value })
  : null;

const report = {
  label: "LIVE read-only adapter smoke",
  manifestIntegrity: manifest.integrity.digest,
  // Host only: an RPC URL can embed a provider key, and a key never belongs in evidence.
  transport: { rpcHost: rpcUrl === undefined ? null : new URL(rpcUrl).host, dnsOverHttps: args.doh },
  pinned,
  codeHashes,
  morpho: { market, position, oraclePrice, collateralFeed, loanFeed, oracleComposition },
  vault: { vault, holder, withdrawal },
  rates: {
    borrowDay,
    vaultDay,
    vaultSixHours,
    instantBorrow,
    fees: vaultFees(vault),
    vaultIncentives,
    marketIncentives,
    comparability: {
      vaultDayVsBorrowDay: comparability(vaultDay, borrowDay),
      vaultSixHoursVsBorrowDay: comparability(vaultSixHours, borrowDay),
      instantVsBorrowDay: comparability(instantBorrow, borrowDay),
    },
  },
  robinhood: { stockToken, lifecycle: { status: lifecycle.status, reasons: lifecycle.reasons, multiplierWad: lifecycle.multiplierWad, asset, quote, actions }, oneToken },
};

const json = JSON.stringify(report, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
await mkdir(".tmp", { recursive: true });
await writeFile(args.out, `${json}\n`, "utf8");

const blocking: ReasonCode[] = ["identity_mismatch", "route_drift"];
const observations: Array<[string, Observation<unknown>]> = [
  ...Object.entries(codeHashes),
  ["morpho.market", market],
  ["vault", vault],
  ["robinhood.asset", asset],
];
const failures = observations.filter(([, observation]) => observation.reasons.some((reason) => blocking.includes(reason)));
const line = (name: string, observation: Observation<unknown> | null) =>
  `${name.padEnd(28)} ${observation === null ? "skipped" : `${observation.status}${observation.reasons.length > 0 ? ` (${observation.reasons.join(", ")})` : ""}`}`;

console.log(`Robinhood block ${block.number} ${block.hash} at ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
for (const [name, observation] of [
  ["morpho.market", market],
  ["morpho.position", position],
  ["oracle.price", oraclePrice],
  ["feed.collateral", collateralFeed],
  ["feed.loan", loanFeed],
  ["vault", vault],
  ["vault.holder", holder],
  ["vault.withdrawal", withdrawal],
  ["rates.borrow.P1D", borrowDay],
  ["rates.vault.P1D", vaultDay],
  ["rates.vault.PT6H", vaultSixHours],
  ["rates.borrow.instant", instantBorrow],
  ["incentives.vault", vaultIncentives],
  ["incentives.market", marketIncentives],
  ["robinhood.token", stockToken],
  ["robinhood.asset", asset],
  ["robinhood.quote", quote],
  ["robinhood.actions", actions],
] as const) console.log(line(name, observation));
console.log(`${"robinhood.lifecycle".padEnd(28)} ${lifecycle.status}${lifecycle.reasons.length > 0 ? ` (${lifecycle.reasons.join(", ")})` : ""}`);
console.log(`${"oracle.composition".padEnd(28)} ${oracleComposition}`);
console.log(`wrote ${args.out}`);
if (failures.length > 0) {
  console.error(`identity or route failure: ${failures.map(([name]) => name).join(", ")}`);
  process.exit(1);
}
