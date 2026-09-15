import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { domainSchemas } from "./schemas.ts";

const generatedDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../generated");
const schemas = Object.fromEntries(
  Object.entries(domainSchemas).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
    }),
  ]),
);

await mkdir(generatedDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(generatedDirectory, "schema.json"),
    `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $defs: schemas }, null, 2)}\n`,
  ),
  writeFile(
    resolve(generatedDirectory, "openapi-components.json"),
    `${JSON.stringify({ openapi: "3.1.0", components: { schemas } }, null, 2)}\n`,
  ),
]);
