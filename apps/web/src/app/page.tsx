import Image from "next/image";

import { GUARDIAN_SELECTORS } from "@crest/contracts";

import { reviewedManifest } from "@/lib/manifest";

/**
 * Route verification screen.
 *
 * Every value on this page comes from the reviewed deployment manifest and the compiled ABI. Nothing is
 * projected, cached, or illustrative, and the evidence class and observation block are always shown with the
 * numbers they qualify.
 */

function Fact({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd style={mono ? { fontFamily: "ui-monospace, monospace", wordBreak: "break-all" } : undefined}>{value}</dd>
    </div>
  );
}

export default function RouteVerificationPage() {
  const manifest = reviewedManifest;

  return (
    <main>
      <header>
        <Image src="/crest-logo.png" alt="Crest — policy-controlled borrowing" width={192} height={144} priority />
        <h1>Verified route</h1>
        <p>
          Reviewed manifest evidence, observed at finalized Robinhood Chain block {manifest.evidence.block.number} (
          {manifest.evidence.block.timestamp}). Not live state.
        </p>
      </header>

      <section aria-labelledby="gate">
        <h2 id="gate">Route gate</h2>
        <dl>
          <Fact label="Outcome" value={manifest.gate.outcome} mono={false} />
          <Fact label="Market gate" value={manifest.gate.marketGate} mono={false} />
          <Fact label="Vault gate" value={manifest.gate.vaultGate} mono={false} />
          <Fact label="Fork lifecycle (Morpho)" value={manifest.forkProof.morphoLifecycle} mono={false} />
          <Fact label="Fork lifecycle (vault)" value={manifest.forkProof.vaultLifecycle} mono={false} />
          <Fact label="Fork proof block" value={manifest.forkProof.blockNumber} />
        </dl>
      </section>

      <section aria-labelledby="market">
        <h2 id="market">Morpho market</h2>
        <dl>
          <Fact label="Market ID" value={manifest.market.id} />
          <Fact label="Loan token" value={manifest.market.loanToken} />
          <Fact label="Collateral token" value={manifest.market.collateralToken} />
          <Fact label="Oracle" value={manifest.market.oracle} />
          <Fact label="IRM" value={manifest.market.irm} />
          <Fact label="LLTV (WAD)" value={manifest.market.lltv} />
          <Fact label="Market liquidity (loan-token units)" value={manifest.market.liquidityAssets} />
          <Fact label="Morpho collateral APY" value="0" />
        </dl>
      </section>

      <section aria-labelledby="vault">
        <h2 id="vault">Strategy vault</h2>
        <dl>
          <Fact label="Vault" value={manifest.vault.address} />
          <Fact label="Generation" value={manifest.vault.generation} mono={false} />
          <Fact label="Asset" value={manifest.vault.asset} />
          <Fact label="Withdrawable assets at the proof block" value={manifest.vault.withdrawableAssets} />
        </dl>
        <p>
          ERC-4626 <code>max*</code> functions return zero on this Vault V2 by design; withdrawal capacity comes from
          native V2 liquidity, not from quoted assets or TVL.
        </p>
      </section>

      <section aria-labelledby="authority">
        <h2 id="authority">Guardian authority</h2>
        <p>Crest Guardian can call exactly these methods, and every one of them can only reduce this account&apos;s debt:</p>
        <ul>
          {GUARDIAN_SELECTORS.map((signature) => (
            <li key={signature} style={{ fontFamily: "ui-monospace, monospace" }}>
              {signature}
            </li>
          ))}
        </ul>
        <p>Borrowing, unfreezing, policy changes, Guardian changes, and withdrawals are owner-only.</p>
      </section>

      <footer>
        <p>
          Manifest integrity {manifest.integrity.algorithm}: <code>{manifest.integrity.digest}</code>
        </p>
      </footer>
    </main>
  );
}
