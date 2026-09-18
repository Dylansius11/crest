import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

/**
 * Local JSON-RPC proxy for pinned-fork work against Robinhood Chain.
 *
 * Two upstream defects break Foundry forking directly: the local ISP hijacks DNS for the official
 * endpoint (its A record resolves to a Telkomsel filter host), and community pools mix archive with
 * pruned backends so a single read can fail with `historical state ... is not available`. This proxy
 * therefore resolves the upstream host to a pinned IP when asked, retries retryable upstream errors,
 * and caches immutable block-pinned reads on disk. Successful responses are forwarded untouched.
 */

const UPSTREAM = process.env.CREST_UPSTREAM_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
/** Set when the upstream hostname is hijacked locally; TLS still uses the real hostname via SNI. */
const UPSTREAM_IP = process.env.CREST_UPSTREAM_IP ?? "";
const PORT = Number(process.env.CREST_PROXY_PORT ?? 8599);
// Only one backend in the pool is a true archive node and it is selected for roughly one request in twelve,
// so pinned-fork reads need many short attempts rather than a few long ones.
const ATTEMPTS = Number(process.env.CREST_PROXY_ATTEMPTS ?? 60);
const BACKOFF_MS = Number(process.env.CREST_PROXY_BACKOFF_MS ?? 50);
const RETRYABLE =
  /historical state|state is not available|missing trie node|header not found|timeout|busy|rate limit|429|-32000|-32005|-32016|-32603/i;

/** Block-pinned reads are immutable, so identical payloads are served from cache instead of upstream. */
const CACHE_PATH = process.env.CREST_PROXY_CACHE ?? ".tmp/rpc-cache.json";
const cache = new Map<string, string>(
  existsSync(CACHE_PATH) ? (Object.entries(JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Record<string, string>)) : [],
);
const MUTABLE = /"(latest|pending|safe|finalized)"/;
let unsaved = 0;
let retried = 0;
let served = 0;

const upstreamUrl = new URL(UPSTREAM);

/** Posts one JSON-RPC payload upstream, optionally to a pinned IP while keeping the real TLS hostname. */
function post(payload: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: UPSTREAM_IP || upstreamUrl.hostname,
        servername: upstreamUrl.hostname,
        port: 443,
        path: upstreamUrl.pathname,
        method: "POST",
        headers: { "content-type": "application/json", host: upstreamUrl.hostname, "content-length": Buffer.byteLength(payload) },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 502, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    request.on("error", reject);
    request.end(payload);
  });
}

async function forward(payload: string): Promise<{ status: number; body: string }> {
  const cacheable = !MUTABLE.test(payload);
  const hit = cacheable ? cache.get(payload) : undefined;
  if (hit !== undefined) {
    served += 1;
    return { status: 200, body: hit };
  }

  let last = { status: 502, body: JSON.stringify({ error: "proxy: no upstream response" }) };

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const { status, body } = await post(payload);
      last = { status, body };
      const failed = body.includes("\"error\"") && RETRYABLE.test(body);
      if (status === 200 && !failed) {
        if (cacheable) {
          cache.set(payload, body);
          unsaved += 1;
          if (unsaved >= 25) {
            writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(cache)), "utf8");
            unsaved = 0;
          }
        }
        return last;
      }
    } catch (error: unknown) {
      last = { status: 502, body: JSON.stringify({ error: String(error) }) };
    }

    retried += 1;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, Math.min(BACKOFF_MS * attempt, 250));
    await promise;
  }

  return last;
}

const server = createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    void forward(Buffer.concat(chunks).toString("utf8")).then(({ status, body }) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`rpc-retry-proxy listening on http://127.0.0.1:${PORT} -> ${UPSTREAM} (retries ${ATTEMPTS})`);
});

process.on("SIGINT", () => {
  writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(cache)), "utf8");
  console.log(`rpc-retry-proxy retried ${retried} upstream requests, served ${served} from cache`);
  server.close(() => process.exit(0));
});
