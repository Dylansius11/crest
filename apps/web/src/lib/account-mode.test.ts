import { describe, expect, test } from "vitest";

import type { WalletState } from "@/components/account/types";
import { accountMode, type AccountModeInput } from "./account-mode";

const OWNER = "0x712683F374Cd524F6336E87D577Fc39d1102930A";
const STRANGER = "0x0000000000000000000000000000000000000001";

const connected: WalletState = { kind: "connected", address: OWNER };
const input = (overrides: Partial<AccountModeInput> = {}): AccountModeInput => ({
  wallet: connected,
  registryLoaded: true,
  registryCount: 1,
  selected: { policyNonce: "3", owner: OWNER.toLowerCase(), lookedUp: false },
  setupInProgress: false,
  ...overrides,
});

describe("account mode", () => {
  test("a visitor with no wallet and no look-up is welcomed", () => {
    expect(accountMode(input({ wallet: { kind: "disconnected" }, registryLoaded: false, registryCount: 0, selected: null }))).toBe("welcome");
    expect(accountMode(input({ wallet: { kind: "connecting" }, registryLoaded: false, registryCount: 0, selected: null }))).toBe("welcome");
  });

  test("a look-up without a wallet, or by a wallet that does not own the account, is read-only", () => {
    const lookedUp = { policyNonce: "3", owner: OWNER, lookedUp: true };
    expect(accountMode(input({ wallet: { kind: "disconnected" }, registryLoaded: false, registryCount: 0, selected: lookedUp }))).toBe("inspect");
    expect(accountMode(input({ wallet: { kind: "connected", address: STRANGER }, selected: lookedUp }))).toBe("inspect");
    expect(accountMode(input({ selected: { ...lookedUp, owner: null } }))).toBe("inspect");
  });

  test("the owner looking up their own account gets the owner dashboard, matched case-insensitively", () => {
    expect(accountMode(input({ selected: { policyNonce: "3", owner: OWNER.toLowerCase(), lookedUp: true } }))).toBe("dashboard");
  });

  test("a wallet on the wrong chain starts setup, where step one offers the switch", () => {
    expect(accountMode(input({ wallet: { kind: "wrong-chain", address: OWNER, chainId: 1 }, selected: null }))).toBe("setup");
  });

  test("the registry is still loading, or the first account is not selected yet", () => {
    expect(accountMode(input({ registryLoaded: false, selected: null }))).toBe("loading");
    expect(accountMode(input({ registryCount: 2, selected: null }))).toBe("loading");
  });

  test("first-timers set up: no account, an account without a policy, or a setup already under way", () => {
    expect(accountMode(input({ registryCount: 0, selected: null }))).toBe("setup");
    expect(accountMode(input({ selected: { policyNonce: "0", owner: OWNER, lookedUp: false } }))).toBe("setup");
    expect(accountMode(input({ setupInProgress: true }))).toBe("setup");
  });

  test("a returning owner with a configured account lands on the dashboard", () => {
    expect(accountMode(input())).toBe("dashboard");
  });
});
