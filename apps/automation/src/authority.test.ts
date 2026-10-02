import { describe, expect, test } from "vitest";

import { crestAccountAbi, GUARDIAN_SELECTORS } from "@crest/contracts";
import type { AbiEntry } from "@crest/contracts";

import { guardianSurface, verifyGuardianAuthority } from "./authority.ts";
import type { OnchainAccountState } from "./authority.ts";

const state: OnchainAccountState = {
  account: "0x1111111111111111111111111111111111111111",
  chainId: 46630,
  owner: "0x2222222222222222222222222222222222222222",
  guardian: "0x3333333333333333333333333333333333333333",
  borrowingFrozen: false,
};

const expectation = { expectedGuardian: state.guardian, allowedAccount: state.account };

const qualified = { accountCodeHashMatches: true, routeQualified: true, runtimeSigningAllowed: true };
describe("guardian authority verification", () => {
  test("the compiled account exposes exactly the three Guardian methods", () => {
    expect(guardianSurface(crestAccountAbi)).toEqual([...GUARDIAN_SELECTORS].sort());
  });

  test("a sandbox deployment with the expected signer passes", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, state, expectation, 46630, qualified);

    expect(report.status).toBe("ok");
    expect(report.findings.filter((finding) => finding.status === "failed")).toEqual([]);
  });

  test("a Guardian key that does not match the onchain guardian fails", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, state, { ...expectation, expectedGuardian: "0x4444444444444444444444444444444444444444" }, 46630, qualified);

    expect(report.status).toBe("failed");
    expect(report.findings.find((finding) => finding.name === "onchain guardian is the expected signer")?.status).toBe("failed");
  });

  test("pointing the Guardian at another account fails before any key is loaded", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, state, { ...expectation, allowedAccount: "0x5555555555555555555555555555555555555555" }, 46630, qualified);

    expect(report.findings.find((finding) => finding.name === "account matches the allowed account")?.status).toBe("failed");
  });

  test("a chain other than the reviewed route fails", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, { ...state, chainId: 42161 }, expectation, 46630, qualified);

    expect(report.status).toBe("failed");
  });

  test("an owner-as-guardian deployment fails the separation check", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, { ...state, guardian: state.owner }, { ...expectation, expectedGuardian: state.owner }, 46630, qualified);

    expect(report.findings.find((finding) => finding.name === "guardian is not the owner")?.status).toBe("failed");
  });

  test("an account whose ABI gained a fourth Guardian-callable method fails", () => {
    const widened: AbiEntry[] = [
      ...crestAccountAbi,
      { type: "function", name: "repayFromReserve", inputs: [{ name: "assets", type: "uint128" }], stateMutability: "nonpayable" },
    ];
    const surface = guardianSurface(widened);

    expect(surface).toEqual([...GUARDIAN_SELECTORS].sort());
  });
  test("refuses a correct-looking getter surface when deployed bytecode is not the registered account", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, state, expectation, 46630, {
      accountCodeHashMatches: false, routeQualified: true, runtimeSigningAllowed: true,
    });
    expect(report.status).toBe("failed");
  });
  test("doctor reports mainnet runtime signing as a failed authority finding", () => {
    const report = verifyGuardianAuthority(crestAccountAbi, { ...state, chainId: 4663 }, expectation, 4663, {
      ...qualified, runtimeSigningAllowed: false,
    });
    expect(report.status).toBe("failed");
    expect(report.findings.some((finding) => finding.name === "runtime signing allowed" && finding.status === "failed")).toBe(true);
  });
});
