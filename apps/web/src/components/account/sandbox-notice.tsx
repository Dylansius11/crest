import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { DeploymentManifest } from "@crest/contracts/manifest";

/**
 * The trust banner for a sandbox route. Every disclosure the manifest records is rendered in full, never
 * summarized away: the owner signs real testnet transactions against a route nobody has reviewed.
 */
export function SandboxNotice({ manifest }: { manifest: DeploymentManifest }) {
  if (manifest.trust.level !== "sandbox") return null;
  return (
    <aside aria-labelledby="sandbox-title" className="hatch border-b border-ink bg-paper px-5 py-4 sm:px-10">
      <div className="mx-auto grid max-w-[85rem] gap-3 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-6">
        <Badge tone="degraded" className="w-fit bg-paper"><FlaskConical aria-hidden className="size-4" />Sandbox</Badge>
        <div className="bg-paper">
          <p id="sandbox-title" className="type-display text-poster-base">Real testnet transactions on an unreviewed route</p>
          <p className="mt-1 max-w-3xl text-sm">
            Your wallet signs real transactions on {manifest.network.name} {manifest.network.chainId}. The route is a labeled sandbox, not reviewed evidence, and its tokens have no monetary value.
          </p>
          <details className="group mt-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">
              Read all {manifest.trust.disclosures.length} disclosures before signing
            </summary>
            <ol className="mt-2 grid max-w-4xl list-decimal gap-2 pl-5 text-sm">
              {manifest.trust.disclosures.map((disclosure) => <li key={disclosure}>{disclosure}</li>)}
            </ol>
          </details>
        </div>
      </div>
    </aside>
  );
}
