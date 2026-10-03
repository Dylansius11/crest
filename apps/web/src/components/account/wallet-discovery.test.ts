import { afterEach, describe, expect, test, vi } from "vitest";
import { subscribeWallets } from "./wallet-discovery";
import { providerOf, selectProvider } from "./wallet-client";
import type { Eip1193Provider } from "./wallet-client";

function fixture() {
  const target = new EventTarget() as EventTarget & { ethereum?: Eip1193Provider };
  const provider = (label: string): Eip1193Provider => ({ request: async () => label });
  const announce = (uuid: string, name: string, wallet: Eip1193Provider) => {
    const event = new Event("eip6963:announceProvider") as Event & { detail: unknown };
    event.detail = { info: { uuid, name, rdns: `test.${name.toLowerCase()}`, icon: "data:image/png;base64,AA==" }, provider: wallet };
    target.dispatchEvent(event);
  };
  return { target, provider, announce };
}

describe("injected wallet selection", () => {
  test("lists independently announced providers instead of silently selecting the last injected wallet", () => {
    const { target, provider, announce } = fixture();
    const first = provider("first");
    const second = provider("second");
    target.ethereum = second;
    target.addEventListener("eip6963:requestProvider", () => {
      announce("a5b68433-58f2-4972-aa09-2b82bf2cee5e", "Wallet One", first);
      announce("33c0435c-6674-4c72-a3ee-6402be7198cf", "Wallet Two", second);
    });
    const changes: Array<Array<{ name: string; provider: Eip1193Provider }>> = [];
    const unsubscribe = subscribeWallets(target, (wallets) => changes.push(wallets));
    expect(changes.at(-1)).toEqual([{ id: "a5b68433-58f2-4972-aa09-2b82bf2cee5e", name: "Wallet One", provider: first }, { id: "33c0435c-6674-4c72-a3ee-6402be7198cf", name: "Wallet Two", provider: second }]);
    announce("a5b68433-58f2-4972-aa09-2b82bf2cee5e", "Wallet One", first);
    expect(changes.at(-1)).toHaveLength(2);
    unsubscribe();
  });

  test("offers legacy injected provider only when no independent wallet announces itself", () => {
    const { target, provider, announce } = fixture();
    const legacy = provider("legacy");
    target.ethereum = legacy;
    let wallets: Array<{ name: string; provider: Eip1193Provider }> = [];
    const unsubscribe = subscribeWallets(target, (next) => { wallets = next; });
    expect(wallets).toEqual([{ id: "legacy", name: "Browser wallet", provider: legacy }]);
    const modern = provider("modern");
    announce("865e8a6f-8163-4fa1-a8f9-385ec7cc1e94", "Modern wallet", modern);
    expect(wallets).toEqual([{ id: "865e8a6f-8163-4fa1-a8f9-385ec7cc1e94", name: "Modern wallet", provider: modern }]);
    unsubscribe();
    announce("06cec118-8f2d-4a4b-8673-5c76e13ab9ce", "Ignored", provider("ignored"));
    expect(wallets).toHaveLength(1);
  });

  test("rejects malformed announcements that cannot request accounts", () => {
    const { target } = fixture();
    let wallets: Array<{ name: string }> = [];
    const unsubscribe = subscribeWallets(target, (next) => { wallets = next; });
    const event = new Event("eip6963:announceProvider") as Event & { detail: unknown };
    event.detail = { info: { uuid: "invalid", name: "Impostor" }, provider: {} };
    target.dispatchEvent(event);
    expect(wallets).toEqual([]);
    unsubscribe();
  });
});

afterEach(() => {
  selectProvider(null);
  vi.unstubAllGlobals();
});

test("transactions use only the chosen provider, never a different window.ethereum", () => {
  const injected: Eip1193Provider = { request: async () => "injected" };
  const chosen: Eip1193Provider = { request: async () => "chosen" };
  vi.stubGlobal("window", { ethereum: injected });
  expect(providerOf()).toBeNull();
  selectProvider(chosen);
  expect(providerOf()).toBe(chosen);
  selectProvider(null);
  expect(providerOf()).toBeNull();
});
