"use client";

import { useActionState, useState } from "react";
import { CURRENCIES, CURRENCY_NAMES, minorUnits, type BillingMode, type Currency, type ModelNameDisplay } from "@llmpense/core";
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
  fixedFee,
  currency,
  modelNames,
  orgShowModelNames,
  paymentTermsDays,
  orgPaymentTermsDays,
}: {
  id: string;
  billingMode: BillingMode;
  markupPct: number;
  /** Monthly fee in `currency`. */
  fixedFee: number;
  currency: Currency;
  modelNames: ModelNameDisplay | null;
  orgShowModelNames: boolean;
  /** Override in days; null follows the org default. */
  paymentTermsDays: number | null;
  orgPaymentTermsDays: number;
}) {
  const [state, action, pending] = useActionState(updateBilling, undefined);
  const [mode, setMode] = useState<BillingMode>(billingMode);
  const [cur, setCur] = useState<Currency>(currency);
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
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Billing currency</span>
          <select name="billingCurrency" className="field" value={cur} onChange={(e) => setCur(e.target.value as Currency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}, {CURRENCY_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Model names on client statements</span>
          <select name="modelNames" className="field" defaultValue={modelNames ?? ""}>
            <option value="">Use default ({orgShowModelNames ? "show" : "hide"})</option>
            <option value="show">Show model names</option>
            <option value="hide">Hide, one line per project</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-sm font-medium">Payment terms (days)</span>
          <input
            className="field num"
            name="paymentTermsDays"
            type="number"
            inputMode="numeric"
            min={0}
            max={365}
            step={1}
            defaultValue={paymentTermsDays ?? ""}
            placeholder={`Default (${orgPaymentTermsDays})`}
          />
          <span className="mt-1 block text-[13px] text-ink-3">Leave empty to use the agency default. Applies when a statement is closed.</span>
        </label>
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
          <span className="mb-1.5 block text-sm font-medium">Monthly fixed fee ({cur})</span>
          <input
            className="field num"
            name="fixedFee"
            type="number"
            inputMode="decimal"
            min={0}
            step={minorUnits(cur) === 0 ? "1" : "0.01"}
            defaultValue={fixedFee}
            disabled={mode !== "fixed"}
          />
        </label>
      </div>
      {/* Disabled inputs are not submitted; keep the stored values. */}
      {mode !== "markup" && <input type="hidden" name="markupPct" value={markupPct} />}
      {mode !== "fixed" && <input type="hidden" name="fixedFee" value={fixedFee} />}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save billing"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
      <p className="text-[13px] text-ink-3">
        Usage is billed in USD and converted on each statement with the month&apos;s exchange rate (ECB reference rate, or your manual
        rate). The fixed fee is in the billing currency. Billed amounts already recorded and closed statements stay as they were. Fixed
        fees apply to every calendar month and are prorated by day in partial ranges.
      </p>
    </form>
  );
}
