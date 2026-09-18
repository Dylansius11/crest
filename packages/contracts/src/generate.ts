import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildArtifact, generatedPath, serializeArtifact } from "./artifact.ts";

const artifact = buildArtifact();
await mkdir(dirname(generatedPath), { recursive: true });
await writeFile(generatedPath, serializeArtifact(artifact), "utf8");
console.log(`wrote ${artifact.abi.length} ABI entries for ${artifact.contract}`);
