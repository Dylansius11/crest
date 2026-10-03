import type { ReactNode } from "react";

import { Cell, Fact } from "@/components/ui/cell";

export function EvidencePanel({
  title,
  evidence,
  children,
}: {
  title: string;
  evidence: "recorded" | "wallet RPC" | "manifest" | "unavailable";
  children: ReactNode;
}) {
  return (
    <Cell index={title} meta={`Evidence: ${evidence}`} className="bg-paper">
      <dl className="px-4 py-1">{children}</dl>
    </Cell>
  );
}

export function EvidenceFact({ label, children }: { label: string; children: ReactNode }) {
  return <Fact label={label}>{children}</Fact>;
}
