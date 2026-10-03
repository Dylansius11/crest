import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";

import { createAppFromManifest } from "./app.ts";

const localEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

const port = Number(process.env.API_PORT ?? 8787);
const app = await createAppFromManifest();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`crest-api listening on http://127.0.0.1:${info.port}`);
});
