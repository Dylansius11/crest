import { GUARDIAN_SELECTORS } from "@crest/contracts";

import { reviewedManifest } from "@/lib/manifest";

/**
 * Every claim on the landing page is bound at build time to the reviewed
 * deployment manifest or the compiled ABI. No string here may invent a
 * number, address, or rate: components pull from these constants so the copy
 * and the evidence can never drift apart.
 *
 * The manifest type carries only the fields the verifier gates. Richer
 * observations in the JSON (rates, governance, fork tool) are read through
 * narrowed local shapes with fallbacks, so a schema tightening can never
 * break the build silently.
 */

const manifest = reviewedManifest;

/** Morpho LLTV as a percent, derived from the manifest WAD value. */
export const marketLltvPercent = (Number(manifest.market.lltv) / 1e18) * 100;

type RateObservation = { value: string; observedAt: string };

/** Observed rates live in the JSON manifest; the TS type does not pin them. */
const rates = (manifest as unknown as {
  rates?: { marketBorrow?: RateObservation; vault?: RateObservation };
}).rates;

/** Vault APY percent from the manifest rate observation. */
export const vaultApyPercent = rates?.vault ? Number(rates.vault.value) * 100 : null;

/** Market borrow APY percent from the manifest rate observation. */
export const borrowApyPercent = rates?.marketBorrow
  ? Number(rates.marketBorrow.value) * 100
  : null;

/** Estimated net spread, vault APY minus borrow APY. Null without both rates. */
export const netSpreadPercent =
  vaultApyPercent !== null && borrowApyPercent !== null
    ? vaultApyPercent - borrowApyPercent
    : null;

/** Observed evidence timestamp, humanized for the poster footer. */
export const evidenceDate = new Date(manifest.evidence.block.timestamp).toLocaleDateString(
  "en-US",
  { month: "short", day: "numeric", year: "numeric" },
);

export const heroStats = [
  { value: "1", label: "Market" },
  { value: "1", label: "Loan token" },
  { value: "1", label: "Vault" },
  { value: "3", label: "Guardian moves" },
] as const;

export const policyBand = {
  lower: "30.0",
  target: "35.0",
  upper: "42.0",
  critical: "50.0",
  lltv: marketLltvPercent.toFixed(1),
} as const;

const percent = (v: number | null, digits = 2) => (v === null ? "n/a" : `${v.toFixed(digits)}%`);

export const carry = {
  vaultApy: percent(vaultApyPercent),
  borrowApy: percent(borrowApyPercent),
  netSpread: percent(netSpreadPercent),
  observedAt: rates?.vault?.observedAt ?? manifest.evidence.retrievedAt,
} as const;

export const authority = {
  owner: ["Create debt", "Change policy", "Unfreeze", "Withdraw", "Change Guardian"],
  guardian: [...GUARDIAN_SELECTORS],
  guardianCannot: [
    "Borrow",
    "Unfreeze",
    "Pick a venue",
    "Pick a receiver",
    "Swap",
    "Sell collateral",
    "Change policy",
    "Touch anything else",
  ],
} as const;

const symbolOf = (key: string) => {
  const entry = manifest.contracts[key];
  return entry && "symbol" in entry && typeof entry.symbol === "string"
    ? entry.symbol
    : null;
};

const nameOf = (key: string) => {
  const entry = manifest.contracts[key];
  return entry && "contractName" in entry && typeof entry.contractName === "string"
    ? entry.contractName
    : key;
};

export const routeFacts = {
  chain: manifest.network.name,
  chainId: manifest.network.chainId,
  block: manifest.evidence.block.number,
  blockTime: manifest.evidence.block.timestamp,
  finality: manifest.evidence.block.finality,
  marketId: manifest.market.id,
  collateral: symbolOf("collateralToken") ?? "Collateral",
  loanToken: symbolOf("loanToken") ?? "Loan token",
  oracle: nameOf("oracle"),
  vaultGeneration: manifest.vault.generation,
  vault: manifest.vault.address,
  integrity: manifest.integrity.digest,
} as const;

export const forkProof = {
  block: manifest.forkProof.blockNumber,
  morphoLifecycle: manifest.forkProof.morphoLifecycle,
  vaultLifecycle: manifest.forkProof.vaultLifecycle,
  outcome: manifest.gate.outcome,
  marketGate: manifest.gate.marketGate,
  vaultGate: manifest.gate.vaultGate,
} as const;
