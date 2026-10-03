import { GUARDIAN_SELECTORS } from "@crest/contracts";
import deploymentEvidence from "../../../../config/deployment-manifest.json";

import { mainnetManifest } from "@/lib/manifest";

/**
 * The landing page shows the reviewed, pinned mainnet evidence. Current account state belongs
 * on the account screen, not in these historical route facts.
 */

const manifest = mainnetManifest;

/** Morpho LLTV as a percent, derived from the manifest WAD value. */
export const marketLltvPercent = (Number(manifest.market.lltv) / 1e18) * 100;

const rates = deploymentEvidence.rates;
const WAD = 10n ** 18n;

function rateWad(value: string | undefined): bigint | null {
  if (value === undefined || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole!) * WAD + BigInt(fraction.padEnd(18, "0"));
}

function percent(value: bigint | null): string {
  if (value === null) return "Unavailable";
  const hundredths = (value < 0n ? -value : value) * 10_000n / WAD;
  return `${value < 0n ? "-" : ""}${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}%`;
}

const vaultRate = rateWad(rates.vault.value);
const borrowRate = rateWad(rates.marketBorrow.value);
const comparable = rates.vault.window === rates.marketBorrow.window;
const vaultShare = vaultRate === null || borrowRate === null || vaultRate + borrowRate === 0n
  ? null
  : Number(vaultRate * 100n / (vaultRate + borrowRate));


export const policyBand = {
  lower: "30.0",
  target: "35.0",
  upper: "42.0",
  critical: "50.0",
  lltv: marketLltvPercent.toFixed(1),
} as const;

export const carry = {
  vaultApy: percent(vaultRate),
  borrowApy: percent(borrowRate),
  netSpread: comparable && vaultRate !== null && borrowRate !== null
    ? percent(vaultRate - borrowRate)
    : "Not comparable",
  vaultShare,
  vaultWindow: rates.vault.window,
  borrowWindow: rates.marketBorrow.window,
  observedAt: rates.vault.observedAt,
  blockNumber: rates.vault.blockNumber,
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

const oraclePrice = BigInt(deploymentEvidence.market.oracleState.price);
const collateralFeed = BigInt(deploymentEvidence.market.oracleState.collateralAnswer);
const loanFeed = BigInt(deploymentEvidence.market.oracleState.loanAnswer);
const priceScale = 10n ** BigInt(36
  + deploymentEvidence.contracts.loanToken.decimals
  - deploymentEvidence.contracts.collateralToken.decimals);

function moneyFromCents(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export const oracleFacts = {
  morphoValue: moneyFromCents((oraclePrice * 100n + priceScale / 2n) / priceScale),
  feedOnlyValue: moneyFromCents((collateralFeed * 100n + loanFeed / 2n) / loanFeed),
  observedBlock: deploymentEvidence.market.state.observedBlockNumber,
} as const;

export const forkProof = {
  block: manifest.forkProof.blockNumber,
  morphoLifecycle: manifest.forkProof.morphoLifecycle,
  vaultLifecycle: manifest.forkProof.vaultLifecycle,
  outcome: manifest.gate.outcome,
  marketGate: manifest.gate.marketGate,
  vaultGate: manifest.gate.vaultGate,
} as const;
