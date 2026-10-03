"use client";

import { Button } from "@/components/ui/button";

export function WelcomeView({ onConnect, address, onAddressChange, notice, onInspect }: {
  onConnect(): void;
  address: string;
  onAddressChange(address: string): void;
  notice: string;
  onInspect(): void;
}) {
  return <div className="mx-auto max-w-[85rem] px-5 py-12 sm:px-10 sm:py-20">
    <h1 className="type-display max-w-4xl text-poster-xl leading-[.95] sm:text-poster-2xl">Keep your stock. Watch your debt.</h1>
    <p className="mt-6 max-w-[65ch] text-base leading-relaxed">Crest lets you borrow USDG against one stock token. Custos can freeze new borrowing or repay your account&apos;s own debt. Only you can borrow, and Custos cannot sell your stock.</p>
    <div className="mt-12 grid gap-px border border-ink bg-ink md:grid-cols-2">
      <section className="flex flex-col items-start bg-crest-600 p-6 text-paper sm:p-10">
        <h2 className="type-display max-w-md text-poster-lg leading-none">Manage your account</h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed">Connect your wallet to set your limits, borrow, repay, or see what Custos did.</p>
        <Button type="button" variant="paper" className="mt-8 active:scale-[.97]" onClick={onConnect}>Connect wallet</Button>
      </section>
      <section className="bg-paper p-6 sm:p-10">
        <h2 className="type-display max-w-md text-poster-lg leading-none">Read an account</h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed">Look up any recorded Crest Account without connecting a wallet. This view cannot sign.</p>
        <form className="mt-8 grid gap-3" onSubmit={(event) => { event.preventDefault(); onInspect(); }}>
          <label className="grid gap-2 text-sm">Crest Account address<input value={address} onChange={(event) => onAddressChange(event.target.value)} placeholder="0x..." spellCheck={false} autoComplete="off" className="min-h-11 w-full min-w-0 border border-ink bg-paper px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-crest-700" /></label>
          <Button type="submit" variant="solid" className="w-fit active:scale-[.97]">Look up account</Button>
          {notice ? <p className="text-sm text-ink-soft" role="status">{notice}</p> : null}
        </form>
      </section>
    </div>
  </div>;
}
