import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { routeFacts } from "@/lib/content";

/**
 * Poster header. Wordmark left at poster scale, evidence chip and owner CTA
 * right. Never sticky: the page scrolls like print.
 */
export function SiteHeader() {
  return (
    <header className="blue-field flex flex-col gap-4 px-5 pt-6 pb-2 sm:flex-row sm:items-center sm:justify-between sm:px-10">
      <Logo priority height={64} className="h-12 sm:h-16" />
      <nav aria-label="Primary" className="flex flex-wrap items-center gap-3">
        <span className="type-display hidden border border-paper/70 px-3 py-2 text-poster-sm text-paper uppercase md:inline-flex">
          {routeFacts.chain} · block {routeFacts.block}
        </span>
        <ButtonLink href="/account" variant="paper">Owner desk</ButtonLink>
        <ButtonLink
          href="#route"
          variant="flame"
          className="shadow-[4px_4px_0_0_var(--color-ink)]"
        >
          View the route
        </ButtonLink>
      </nav>
    </header>
  );
}
