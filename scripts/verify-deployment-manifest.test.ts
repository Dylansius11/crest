import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRoute,
  computeManifestIntegrity,
  validateDeploymentManifest,
} from "./verify-deployment-manifest.ts";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}`;
const hash = (suffix: string) => `0x${suffix.padStart(64, "0")}`;

function fixture() {
  const manifest = {
    schemaVersion: 1,
    network: { chainId: 4663, name: "Robinhood Chain" },
    trust: { level: "reviewed", disclosures: [] as string[] },
    evidence: {
      retrievedAt: "2026-09-14T09:12:04Z",
      block: { number: "62692076", hash: hash("11"), timestamp: "2026-09-14T09:12:04Z", finality: "finalized" },
    },
    contracts: {
      morpho: { address: address("1"), codeHash: hash("a1") },
      loanToken: { address: address("2"), codeHash: hash("a2"), decimals: 6 },
      collateralToken: { address: address("3"), codeHash: hash("a3"), decimals: 18 },
      oracle: { address: address("4"), codeHash: hash("a4") },
      irm: { address: address("5"), codeHash: hash("a5") },
    },
    market: {
      id: hash("b1"),
      derivedId: hash("b1"),
      loanToken: address("2"),
      collateralToken: address("3"),
      oracle: address("4"),
      irm: address("5"),
      lltv: "625000000000000000",
      liquidityAssets: "45346210000",
      plannedBorrowAssets: "1000000000",
    },
    vault: {
      address: address("6"),
      codeHash: hash("a6"),
      asset: address("2"),
      generation: "Morpho Vault V2",
      maxFunctions: { maxDeposit: "0", maxMint: "0", maxWithdraw: "0", maxRedeem: "0" },
      governance: { liquidityAdapter: address("7") },
      state: { sharePriceRay: "1007219646915321488459496036" },
      downstreamAllocations: [
        { adapter: address("7"), marketId: hash("c1"), liquidityRole: "default" },
        { adapter: address("7"), marketId: hash("c2"), liquidityRole: "allocated" },
      ],
      withdrawableAssets: "31766601863450",
      plannedWithdrawalAssets: "1000000000",
    },
    forkProof: {
      blockNumber: "62692076",
      blockHash: hash("11"),
      morphoLifecycle: "passed",
      vaultLifecycle: "passed",
    },
    gate: { outcome: "full_route", marketGate: "passed", vaultGate: "passed" },
  };
  return { ...manifest, integrity: { algorithm: "sha256", digest: computeManifestIntegrity(manifest) } };
}

test("accepts coherent verified route evidence", () => {
  assert.deepEqual(validateDeploymentManifest(fixture()), []);
});

test("rejects a vault route without exactly one default liquidity market on the reviewed adapter", () => {
  const none = structuredClone(fixture());
  none.vault.downstreamAllocations = none.vault.downstreamAllocations.map((entry) => ({ ...entry, liquidityRole: "allocated" }));
  none.integrity.digest = computeManifestIntegrity(none);
  assert.deepEqual(validateDeploymentManifest(none), ["vault must name exactly one default liquidity market on its liquidity adapter"]);

  const foreign = structuredClone(fixture());
  foreign.vault.governance.liquidityAdapter = address("8");
  foreign.integrity.digest = computeManifestIntegrity(foreign);
  assert.deepEqual(validateDeploymentManifest(foreign), ["vault must name exactly one default liquidity market on its liquidity adapter"]);
});

function sandbox() {
  const manifest = structuredClone(fixture());
  manifest.network = { chainId: 46630, name: "Robinhood Chain Testnet" };
  manifest.trust = { level: "sandbox", disclosures: ["Mock oracle price is publicly settable."] };
  return manifest;
}

function sealed<T extends { integrity: { digest: string } }>(manifest: T): T {
  manifest.integrity.digest = computeManifestIntegrity(manifest);
  return manifest;
}

test("a testnet route is only ever a disclosed sandbox", () => {
  assert.deepEqual(validateDeploymentManifest(sealed(sandbox())), []);
  const reviewed = sandbox();
  reviewed.trust.level = "reviewed";
  assert.deepEqual(validateDeploymentManifest(sealed(reviewed)), ["trust.level must be sandbox on chain 46630"]);
  const silent = sandbox();
  silent.trust.disclosures = [];
  assert.deepEqual(validateDeploymentManifest(sealed(silent)), ["a sandbox route must disclose why it is not reviewed"]);
});

test("mainnet cannot be downgraded to a sandbox route", () => {
  const manifest = structuredClone(fixture());
  manifest.trust.level = "sandbox";
  assert.deepEqual(validateDeploymentManifest(sealed(manifest)), ["trust.level must be reviewed on chain 4663"]);
});

test("an idle-only vault names no default liquidity market", () => {
  const idle = (roles: Array<"default" | "allocated">) => {
    const manifest = sandbox();
    manifest.vault.governance.liquidityAdapter = address("0");
    manifest.vault.downstreamAllocations = roles.map((liquidityRole, index) => ({ adapter: address("9"), marketId: hash(`d${index}`), liquidityRole }));
    return sealed(manifest);
  };
  assert.deepEqual(validateDeploymentManifest(idle(["allocated"])), []);
  assert.deepEqual(validateDeploymentManifest(idle(["default"])), ["an idle-only vault has no default liquidity market"]);
});

test("accepts reserve-only evidence when the market passes and vault liquidity fails", () => {
  const manifest = structuredClone(fixture());
  manifest.vault.withdrawableAssets = "0";
  manifest.forkProof.vaultLifecycle = "failed";
  manifest.gate.vaultGate = "failed";
  manifest.gate.outcome = "reserve_only";
  manifest.integrity.digest = computeManifestIntegrity(manifest);
  assert.deepEqual(validateDeploymentManifest(manifest), []);
});

test("rejects altered chain evidence", () => {
  const manifest = structuredClone(fixture());
  manifest.network.chainId = 1;
  assert.ok(validateDeploymentManifest(manifest).length > 0);
});

test("rejects evidence that is not finalized", () => {
  const manifest = structuredClone(fixture());
  manifest.evidence.block.finality = "unfinalized";
  manifest.integrity.digest = computeManifestIntegrity(manifest);
  assert.deepEqual(validateDeploymentManifest(manifest), ["evidence.block.finality must be finalized"]);
});

test("rejects altered code hash evidence", () => {
  const manifest = structuredClone(fixture());
  manifest.contracts.morpho.codeHash = hash("ff");
  assert.ok(validateDeploymentManifest(manifest).length > 0);
});

test("rejects altered market id evidence", () => {
  const manifest = structuredClone(fixture());
  manifest.market.id = hash("ff");
  assert.ok(validateDeploymentManifest(manifest).length > 0);
});

test("rejects altered vault asset evidence", () => {
  const manifest = structuredClone(fixture());
  manifest.vault.asset = address("ff");
  assert.ok(validateDeploymentManifest(manifest).length > 0);
});

test("rejects altered block hash evidence", () => {
  const manifest = structuredClone(fixture());
  manifest.evidence.block.hash = hash("ff");
  assert.ok(validateDeploymentManifest(manifest).length > 0);
});

test("accepts a fork pinned at a block after the finalized evidence block", () => {
  const manifest = structuredClone(fixture());
  manifest.forkProof.blockNumber = String(BigInt(manifest.evidence.block.number) + 4096n);
  manifest.forkProof.blockHash = hash("ab");
  manifest.integrity.digest = computeManifestIntegrity(manifest);
  assert.deepEqual(validateDeploymentManifest(manifest), []);
});

test("rejects a fork pinned before the finalized evidence block", () => {
  const manifest = structuredClone(fixture());
  manifest.forkProof.blockNumber = String(BigInt(manifest.evidence.block.number) - 1n);
  manifest.integrity.digest = computeManifestIntegrity(manifest);
  assert.deepEqual(validateDeploymentManifest(manifest), ["fork proof block precedes the evidence block"]);
});

test("market failure stops the route", () => {
  assert.equal(classifyRoute({ marketVerified: false, marketLiquidityAssets: 10n, plannedBorrowAssets: 1n, vaultVerified: true, vaultWithdrawableAssets: 10n, plannedWithdrawalAssets: 1n }), "stop");
});

test("qualified market with insufficient vault liquidity is reserve-only", () => {
  assert.equal(classifyRoute({ marketVerified: true, marketLiquidityAssets: 10n, plannedBorrowAssets: 1n, vaultVerified: true, vaultWithdrawableAssets: 0n, plannedWithdrawalAssets: 1n }), "reserve_only");
});

test("qualified liquid market and vault form a full route", () => {
  assert.equal(classifyRoute({ marketVerified: true, marketLiquidityAssets: 10n, plannedBorrowAssets: 1n, vaultVerified: true, vaultWithdrawableAssets: 10n, plannedWithdrawalAssets: 1n }), "full_route");
});
