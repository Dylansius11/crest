"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Cell } from "@/components/ui/cell";
import { activeTokens } from "@/lib/manifest";

const { collateral, loan } = activeTokens;

export type PolicyFormValues = {
  guardian: string;
  maxCollateral: string;
  debtCeiling: string;
  maxStrategy: string;
  reserveFloor: string;
  strategyFloor: string;
  maxRepay: string;
  lowerLtv: string;
  targetLtv: string;
  upperLtv: string;
  criticalLtv: string;
  minimumNetSpreadBps: string;
  maxOracleDivergenceBps: string;
  harvestThreshold: string;
  freezeOnOracleDegraded: boolean;
  freezeOnVaultDegraded: boolean;
  freezeOnLifecycleDegraded: boolean;
};

const emptyPolicy: PolicyFormValues = {
  guardian: "",
  maxCollateral: "",
  debtCeiling: "",
  maxStrategy: "",
  reserveFloor: "",
  strategyFloor: "",
  maxRepay: "",
  lowerLtv: "",
  targetLtv: "",
  upperLtv: "",
  criticalLtv: "",
  minimumNetSpreadBps: "",
  maxOracleDivergenceBps: "",
  harvestThreshold: "",
  freezeOnOracleDegraded: true,
  freezeOnVaultDegraded: true,
  freezeOnLifecycleDegraded: true,
};

type NumericPolicyField = Exclude<keyof PolicyFormValues, "guardian" | "freezeOnOracleDegraded" | "freezeOnVaultDegraded" | "freezeOnLifecycleDegraded">;

const fields: readonly { key: NumericPolicyField; label: string; unit: string }[] = [
  { key: "maxCollateral", label: "Collateral cap", unit: collateral.symbol },
  { key: "debtCeiling", label: "Debt ceiling", unit: loan.symbol },
  { key: "maxStrategy", label: "Strategy cap", unit: loan.symbol },
  { key: "reserveFloor", label: "Reserve floor", unit: loan.symbol },
  { key: "strategyFloor", label: "Strategy floor", unit: loan.symbol },
  { key: "maxRepay", label: "Guardian repay cap", unit: loan.symbol },
  { key: "lowerLtv", label: "Lower LTV", unit: "%" },
  { key: "targetLtv", label: "Target LTV", unit: "%" },
  { key: "upperLtv", label: "Upper LTV", unit: "%" },
  { key: "criticalLtv", label: "Critical LTV", unit: "%" },
  { key: "minimumNetSpreadBps", label: "Minimum net spread", unit: "bps" },
  { key: "maxOracleDivergenceBps", label: "Maximum oracle divergence", unit: "bps" },
  { key: "harvestThreshold", label: "Harvest threshold", unit: loan.symbol },
];

type DraftResult = {
  label: "Draft";
  draft: PolicyFormValues;
  model: string;
  fallbackUsed: boolean;
  rationale: string;
  assumptions: string[];
  issues: string[];
};

export function PolicyEditor({
  disabledReason,
  draftContext,
  onCompile,
  onEdit,
  issues,
}: {
  draftContext: { owner: string; account: string } | null;
  disabledReason: string | null;
  onCompile(values: PolicyFormValues): void;
  onEdit(): void;
  issues: readonly string[];
}) {
  const [values, setValues] = useState<PolicyFormValues>(emptyPolicy);
  const [prompt, setPrompt] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftDisabled, setDraftDisabled] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [draftNotice, setDraftNotice] = useState<DraftResult | null>(null);
  const editVersion = useRef(0);

  async function requestDraft() {
    if (!draftContext || !values.guardian || drafting) {
      setDraftError("Connect the owner and select an account, then enter a Guardian address before drafting.");
      return;
    }
    setDrafting(true);
    const version = editVersion.current;
    setDraftError("");
    try {
      const { guardian, ...formLimits } = values;
      const current = Object.fromEntries(Object.entries(formLimits).filter(([, value]) => typeof value === "boolean" || value.trim() !== ""));
      const response = await fetch("/v1/policy/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt, guardian, ...draftContext, current }),
      });
      if (!response.ok) {
        const failure: { error?: string } = await response.json().catch(() => ({}));
        if (response.status === 503) setDraftDisabled(true);
        throw new Error(failure.error ?? `Draft service returned ${response.status}`);
      }
      if (version !== editVersion.current) return;
      const result: DraftResult = await response.json();
      if (version !== editVersion.current) return;
      if (result.label !== "Draft" || !result.draft || result.draft.guardian.toLowerCase() !== guardian.toLowerCase()) {
        throw new Error("Draft service returned an invalid policy. The manual form is unchanged.");
      }
      setValues(result.draft);
      setDraftNotice(result);
      onEdit();
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "Drafting is unavailable. Use the manual policy form.");
    } finally {
      setDrafting(false);
    }
  }

  return (
    <details className="group min-w-0 border border-ink bg-paper">
      <summary className="cursor-pointer px-4 py-4 type-display text-poster-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crest-700">
        Configure owner policy <span className="ml-2 text-xs font-sans font-normal normal-case text-ink-soft">Expand the exact onchain draft</span>
      </summary>
    <Cell index="Owner policy draft" meta="Typed before signature" className="border-x-0 border-b-0 bg-paper">
      <form
        className="p-4"
        onChangeCapture={(event) => {
          editVersion.current += 1;
          if (event.target instanceof HTMLTextAreaElement) return;
          onEdit();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          onCompile(values);
        }}
      >
        <p className="max-w-3xl text-sm text-ink-soft">
          The exact market, oracle, vault, and receiver come only from the qualified deployment manifest. Enter decimal token amounts and percentage points. Custos can freeze or repay this account’s own debt, never borrow.
        </p>
        <div className="mt-5 border border-ink bg-paper-soft p-3 sm:p-4">
          <label htmlFor="policy-draft-prompt" className="type-display text-poster-sm uppercase">Draft with AI</label>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">Optional untrusted draft only. Review every limit before compiling. Nothing is staged or signed by this action.</p>
          <textarea
            id="policy-draft-prompt"
            rows={3}
            maxLength={2000}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe your limits and safety preferences"
            className="mt-3 w-full min-w-0 border border-ink bg-paper p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crest-700"
            disabled={draftDisabled}
          />
          <Button type="button" variant="outline" className="mt-3 w-full sm:w-auto" onClick={requestDraft}
            disabled={drafting || draftDisabled || !prompt.trim() || !draftContext || !values.guardian}>
            {drafting ? "Drafting policy..." : draftDisabled ? "AI drafting unavailable" : "Draft with AI"}
          </Button>
          {draftError ? <p className="mt-3 text-sm text-signal-stop" role="alert">{draftError}</p> : null}
          {draftNotice ? (
            <div className="mt-3 border border-signal-warn p-3 text-sm" role="status">
              <p className="font-semibold">Draft from {draftNotice.model}, review every field before signing.</p>
              <p className="mt-2">{draftNotice.rationale}</p>
              {draftNotice.assumptions.length > 0 ? <ul className="mt-2 list-disc pl-5">{draftNotice.assumptions.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              {draftNotice.issues.length > 0 ? <ul className="mt-2 list-disc pl-5">{draftNotice.issues.map((item) => <li key={item}>{item}</li>)}</ul> : null}
              <p className="mt-2">Not staged. Not signed. The owner must compile and approve the exact configuration.</p>
            </div>
          ) : null}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <label className="grid gap-1 text-sm sm:col-span-2 xl:col-span-3">
            <span className="type-display text-poster-sm uppercase">Guardian address</span>
            <input
              required
              value={values.guardian}
              onChange={(event) => setValues((current) => ({ ...current, guardian: event.target.value }))}
              className="min-h-11 border border-ink bg-paper px-3 font-mono text-sm"
              inputMode="text"
              spellCheck={false}
              placeholder="0x…"
              aria-describedby="guardian-help"
            />
            <span id="guardian-help" className="text-xs text-ink-soft">A distinct nonzero address. It gains only freeze and bounded own-debt repayment.</span>
          </label>
          {fields.map((field) => (
            <label key={field.key} className="grid gap-1 text-sm">
              <span className="type-display text-poster-sm uppercase">{field.label} ({field.unit})</span>
              <input
                required
                value={values[field.key]}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="min-h-11 border border-ink bg-paper px-3 font-mono text-sm"
                inputMode="decimal"
                placeholder="Owner input required"
              />
            </label>
          ))}
        </div>
        <fieldset className="mt-4 border border-ink p-3">
          <legend className="px-1 type-display text-poster-sm">Degraded-source protection</legend>
          <p className="mb-3 text-sm text-ink-soft">These settings can only tighten borrowing. Each is visible in the typed draft before it compiles.</p>
          {([
            ["freezeOnOracleDegraded", "Freeze on oracle degradation"],
            ["freezeOnVaultDegraded", "Freeze on vault degradation"],
            ["freezeOnLifecycleDegraded", "Freeze on lifecycle degradation"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" checked={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.checked }))} className="size-5 accent-ink" />
              {label}
            </label>
          ))}
        </fieldset>
        {issues.length > 0 ? (
          <div className="mt-4 border border-signal-stop bg-paper-soft p-3" role="alert">
            <p className="type-display text-poster-sm text-signal-stop">Draft cannot compile</p>
            <ul className="mt-2 list-disc pl-5 text-sm">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </div>
        ) : null}
        <Button type="submit" variant="flame" className="mt-5 w-full sm:w-auto" disabled={disabledReason !== null}>
          {disabledReason ?? "Compile exact configuration"}
        </Button>
      </form>
    </Cell>
    </details>
  );
}
