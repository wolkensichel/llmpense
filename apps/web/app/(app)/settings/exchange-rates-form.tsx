"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { CURRENCIES, CURRENCY_NAMES } from "@llmpense/core";
import { addRateOverride, syncRatesNow } from "./exchange-rates-actions.ts";

export function RateOverrideForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(addRateOverride, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Currency</span>
          <select name="currency" className="field" defaultValue="EUR">
            {CURRENCIES.filter((c) => c !== "USD").map((c) => (
              <option key={c} value={c}>
                {c}, {CURRENCY_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">1 USD =</span>
          <input name="ratePerUsd" type="number" inputMode="decimal" min="0" step="any" required placeholder="0.92" className="field num" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Applies from</span>
          <input name="effectiveFrom" type="date" required defaultValue={today} className="field num" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Note <span className="font-normal text-ink-3">(optional)</span>
          </span>
          <input name="note" maxLength={200} placeholder="Contract rate" className="field" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Add manual rate"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
    </form>
  );
}

export function SyncRatesButton() {
  const [state, action, pending] = useActionState(syncRatesNow, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button className="btn btn-quiet" disabled={pending}>
        <RefreshCw size={16} aria-hidden className={pending ? "animate-spin" : ""} /> {pending ? "Fetching…" : "Fetch ECB rates now"}
      </button>
      <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
        {state?.error ?? state?.ok}
      </p>
    </form>
  );
}
