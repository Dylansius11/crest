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
    return [
      { source: "/v1/accounts", destination: `${api}/v1/accounts` },
      { source: "/v1/accounts/:address/position", destination: `${api}/v1/accounts/:address/position` },
    ];
  },
};

export default config;
