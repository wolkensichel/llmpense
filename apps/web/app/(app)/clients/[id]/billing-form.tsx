"use client";

import { useActionState, useState } from "react";
import type { BillingMode } from "@llmpense/core";
import { updateBilling } from "./actions.ts";

const MODES: { value: BillingMode; label: string; hint: string }[] = [
  { value: "markup", label: "Markup", hint: "Provider cost plus a percentage." },
  { value: "passthrough", label: "Pass-through", hint: "Provider cost, nothing added." },
  { value: "fixed", label: "Fixed fee", hint: "A flat monthly fee covers all AI usage." },
  { value: "absorbed", label: "Absorbed", hint: "You carry the cost; the client pays nothing for AI." },
];

export function BillingForm({
  id,
  billingMode,
  markupPct,
  fixedFeeUsd,
}: {
  id: string;
  billingMode: BillingMode;
  markupPct: number;
  fixedFeeUsd: number;
}) {
  const [state, action, pending] = useActionState(updateBilling, undefined);
  const [mode, setMode] = useState<BillingMode>(billingMode);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How this client pays for AI</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 ${
                mode === m.value ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"
              }`}
            >
              <input
                type="radio"
                name="billingMode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                className="mt-1 accent-[var(--accent)]"
              />
              <span>
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-[13px] text-ink-2">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={mode === "markup" ? "" : "opacity-50"}>
          <span className="mb-1.5 block text-sm font-medium">Markup %</span>
          <input
            className="field num"
            name="markupPct"
            type="number"
            inputMode="decimal"
            min={0}
            max={1000}
            step="0.01"
            defaultValue={markupPct}
            disabled={mode !== "markup"}
          />
        </label>
        <label className={mode === "fixed" ? "" : "opacity-50"}>
          <span className="mb-1.5 block text-sm font-medium">Monthly fixed fee (USD)</span>
          <input
            className="field num"
            name="fixedFeeUsd"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue={fixedFeeUsd}
            disabled={mode !== "fixed"}
          />
        </label>
      </div>
      {/* Disabled inputs are not submitted; keep the stored values. */}
      {mode !== "markup" && <input type="hidden" name="markupPct" value={markupPct} />}
      {mode !== "fixed" && <input type="hidden" name="fixedFeeUsd" value={fixedFeeUsd} />}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save billing"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
      <p className="text-[13px] text-ink-3">
        Billed amounts already recorded stay as they were. Fixed fees apply to every calendar month and are prorated by day in
        partial ranges.
      </p>
    </form>
  );
}
