import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // The workspace ships TypeScript sources; Next compiles the packages the app imports.
  transpilePackages: ["@crest/contracts", "@crest/domain"],
  // Monorepo root, so file tracing does not walk past the workspace.
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default config;
