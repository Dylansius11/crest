import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export function SiteHeader() {
  return (
    <header className="blue-field px-5 py-3 sm:px-10">
      <div className="mx-auto flex max-w-[85rem] items-center justify-between gap-4">
        <a href="/" aria-label="Crest home"><Logo priority height={56} className="h-12 sm:h-14" /></a>
        <nav aria-label="Primary" className="flex items-center gap-3">
          <a href="#proof" className="hidden min-h-11 items-center text-sm text-paper underline-offset-4 hover:underline focus-visible:underline sm:inline-flex">Proof</a>
          <ButtonLink href="/account" variant="paper" className="whitespace-nowrap transition-transform duration-150 active:scale-[0.97]">Open your account</ButtonLink>
        </nav>
      </div>
    </header>
  );
}
