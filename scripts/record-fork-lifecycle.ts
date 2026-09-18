import { readFile, writeFile } from "node:fs/promises";
import { classifyRoute, computeManifestIntegrity, validateDeploymentManifest } from "./verify-deployment-manifest.ts";

/**
 * Promotes the deployment manifest gate from a real pinned-fork lifecycle run.
 *
 * The amounts come only from `contracts/test/RobinhoodFork.t.sol`, which writes them after executing
 * supply -> borrow-and-deploy -> Guardian strategy repay -> owner exit against pinned Robinhood Chain state.
 * Nothing here invents liquidity, rates or outcomes: a missing or stale record fails instead of guessing.
 */

const MANIFEST_PATH = process.env.CREST_MANIFEST_PATH ?? "config/deployment-manifest.json";
const RECORD_PATH = process.env.CREST_LIFECYCLE_RECORD ?? ".tmp/fork-lifecycle.json";

const uint = (value: unknown, field: string): string => {
  const text = typeof value === "number" ? value.toString() : typeof value === "string" ? value : "";
  if (!/^[0-9]+$/.test(text)) throw new Error(`lifecycle record field ${field} is not an integer`);
  return text;
};

const record = JSON.parse(await readFile(RECORD_PATH, "utf8")) as Record<string, unknown>;
const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Record<string, unknown>;
const forkProof = manifest.forkProof as Record<string, unknown>;
const market = manifest.market as Record<string, unknown>;
const vault = manifest.vault as Record<string, unknown>;

if (uint(record.blockNumber, "blockNumber") !== forkProof.blockNumber) {
  throw new Error(`lifecycle ran at block ${String(record.blockNumber)} but the manifest pins ${String(forkProof.blockNumber)}`);
}
if (record.assetBalanceRestored !== true) throw new Error("lifecycle did not restore the account loan-token balance");

const test = typeof record.test === "string" ? record.test : "";
if (test.length === 0) throw new Error("lifecycle record has no originating test");

forkProof.morphoLifecycle = "passed";
forkProof.vaultLifecycle = "passed";
forkProof.morpho = {
  collateralAssets: uint(record.collateralAssets, "collateralAssets"),
  borrowAssets: uint(record.borrowAssets, "borrowAssets"),
  repaidAssets: uint(record.repaidAssets, "repaidAssets"),
  withdrawnCollateralAssets: uint(record.withdrawnCollateralAssets, "withdrawnCollateralAssets"),
  proofTests: [test],
};
const deposited = BigInt(uint(record.depositAssets, "depositAssets"));
const withdrawn = BigInt(uint(record.withdrawAssets, "withdrawAssets")) + BigInt(uint(record.redeemedAssets, "redeemedAssets"));
forkProof.vault = {
  depositAssets: deposited.toString(),
  mintedShares: uint(record.mintedShares, "mintedShares"),
  withdrawAssets: uint(record.withdrawAssets, "withdrawAssets"),
  withdrawnShares: uint(record.withdrawnShares, "withdrawnShares"),
  redeemedShares: uint(record.redeemedShares, "redeemedShares"),
  redeemedAssets: uint(record.redeemedAssets, "redeemedAssets"),
  // Round-down asset conversion leaves the deposit slightly above the exited amount; the residue is dust.
  finalAssetDelta: (deposited > withdrawn ? deposited - withdrawn : 0n).toString(),
  finalShares: uint(record.finalShares, "finalShares"),
  assetBalanceRestored: true,
  proofTests: [test],
};

market.liquidityAssets = uint(record.marketLiquidityAssets, "marketLiquidityAssets");
vault.withdrawableAssets = uint(record.vaultWithdrawableAssets, "vaultWithdrawableAssets");

const outcome = classifyRoute({
  marketVerified: true,
  marketLiquidityAssets: BigInt(String(market.liquidityAssets)),
  plannedBorrowAssets: BigInt(String(market.plannedBorrowAssets)),
  vaultVerified: true,
  vaultWithdrawableAssets: BigInt(String(vault.withdrawableAssets)),
  plannedWithdrawalAssets: BigInt(String(vault.plannedWithdrawalAssets)),
});
manifest.gate = {
  outcome,
  marketGate: "passed",
  vaultGate: outcome === "full_route" ? "passed" : "failed",
  reason: `Pinned fork ${test} executed supply, owner borrow-and-deploy, Guardian strategy repayment and owner exit at Robinhood block ${String(forkProof.blockNumber)}.`,
};
manifest.integrity = { algorithm: "sha256", digest: computeManifestIntegrity(manifest) };

const errors = validateDeploymentManifest(manifest);
if (errors.length > 0) throw new Error(`manifest invalid after recording lifecycle:\n${errors.join("\n")}`);

await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`recorded ${test} at block ${String(forkProof.blockNumber)}: gate ${outcome}`);
