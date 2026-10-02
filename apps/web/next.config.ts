import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The workspace ships TypeScript sources; Next compiles the packages the app imports.
  transpilePackages: ["@crest/contracts", "@crest/domain"],
  // Monorepo root, so file tracing does not walk past the workspace.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  async rewrites() {
    const api = process.env.CREST_API_URL ?? "http://127.0.0.1:8787";
    // Browser chain reads stay same-origin; the server forwards them. Locally, point CREST_RPC_UPSTREAM at the
    // SNI-preserving retry proxy when the public hostname does not resolve to the real origin.
    const chainId = Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? 46630);
    const manifestFile = chainId === 4663 ? "deployment-manifest.json" : "deployment-manifest.46630.json";
    const manifest = JSON.parse(readFileSync(new URL(`../../config/${manifestFile}`, import.meta.url), "utf8")) as { network: { rpcUrl: string } };
    const rpc = process.env.CREST_RPC_UPSTREAM ?? manifest.network.rpcUrl;
    return [
      { source: "/rpc", destination: rpc },
      { source: "/v1/accounts", destination: `${api}/v1/accounts` },
      { source: "/v1/policy/draft", destination: `${api}/v1/policy/draft` },
      { source: "/v1/accounts/register", destination: `${api}/v1/accounts/register` },
      { source: "/v1/accounts/:address/position", destination: `${api}/v1/accounts/:address/position` },
      { source: "/v1/accounts/:address/policies", destination: `${api}/v1/accounts/:address/policies` },
    ];
  },
};

export default config;
