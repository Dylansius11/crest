import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { KeyStrip } from "./key-strip";
import type { RecordedPosition } from "./types";

const position: RecordedPosition = {
  evidence: "recorded",
  account: { address: "0xaD8A3272c6E68cF819fe1E3b2aEFD0f8Fd5b2c75", chainId: "46630", codeHash: "0x01", policyNonce: "3", status: "active" },
  snapshot: {
    blockNumber: "127691278", blockHash: "0x02", observedAt: "2026-10-03T08:00:00Z",
    owner: "0x712683F374Cd524F6336E87D577Fc39d1102930A", guardian: "0xBBF6Ec4a16Babf20A1a14D8D8DEf7e3f6442A4dC", frozen: true,
    collateralAssets: "2000000000000000000", debtAssets: "1000000", collateralValueAssets: null, ltvWad: null, morphoHealthWad: null,
    lowerLtvWad: "10000000000000000", targetLtvWad: "20000000000000000", upperLtvWad: "30000000000000000", criticalLtvWad: "40000000000000000",
    reserveAssets: "0", vaultShares: "0", quotedVaultAssets: "0", withdrawableVaultAssets: null,
    reserveFloorAssets: "0", strategyFloorAssets: "0", maxRepayPerActionAssets: "1000000",
  },
  assessment: null, realizedDebtRepaidAssets: null, latestRepayment: null,
  latestIntervention: {
    actionKind: "freeze", requestedAssets: null, status: "failed", reasonCodes: [], detectedAt: "2026-10-03T08:00:00Z", forCurrentAssessment: true,
    run: { status: "failed", failureClass: "pre_sign_validation_or_simulation", transactionHash: null, checks: [] },
  },
};

describe("account key strip", () => {
  test("unknown valuation is not presented as zero LTV when debt exists", () => {
    const html = renderToStaticMarkup(<KeyStrip position={position} />);
    expect(html).toContain("Current LTV");
    expect(html).toContain("Unavailable");
    expect(html).toContain("No collateral valuation");
  });

  test("a failed pre-sign attempt is not presented as a failed transaction", () => {
    const html = renderToStaticMarkup(<KeyStrip position={position} />);
    expect(html).toContain("Skipped before signing");
    expect(html).toContain("Nothing was signed");
    expect(html).not.toContain("pre_sign_validation_or_simulation");
  });
});
