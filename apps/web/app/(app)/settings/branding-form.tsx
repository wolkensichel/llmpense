"use client";

import { useActionState, useState } from "react";
import { formatStatementNumber, validateNumberFormat } from "@llmpense/core";
import type { Branding } from "@/lib/branding.ts";
import { saveBranding } from "./branding-actions.ts";

export function BrandingForm({ branding, numbering }: { branding: Branding; numbering: { format: string; paymentTermsDays: number } }) {
  const [state, action, pending] = useActionState(saveBranding, undefined);
  const [format, setFormat] = useState(numbering.format);
  const check = validateNumberFormat(format);
  const year = new Date().getUTCFullYear();
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Agency name</span>
          <input name="brandName" required maxLength={120} defaultValue={branding.name} className="field" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Logo URL <span className="font-normal text-ink-3">(optional)</span>
          </span>
          <input
            name="brandLogoUrl"
            type="url"
            inputMode="url"
            maxLength={2000}
            defaultValue={branding.logoUrl ?? ""}
            placeholder="https://example.com/logo.png"
            className="field"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Address <span className="font-normal text-ink-3">(optional)</span>
          </span>
          <textarea
            name="brandAddress"
            rows={3}
            maxLength={500}
            defaultValue={branding.address ?? ""}
            placeholder={"Street 1\n00100 City\nhello@example.com"}
            className="field py-2.5"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">
            Footer text <span className="font-normal text-ink-3">(optional)</span>
          </span>
          <textarea
            name="brandFooter"
            rows={3}
            maxLength={1000}
            defaultValue={branding.footer ?? ""}
            placeholder="Payment details, registration or tax number"
            className="field py-2.5"
          />
        </label>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-surface-2">
        <input
          type="checkbox"
          name="showModelNames"
          defaultChecked={branding.showModelNames}
          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>
          <span className="block text-sm font-medium">Show model names on client statements</span>
          <span className="block text-[13px] text-ink-2">
            When off, statements and their CSV show one line per project with requests, tokens and amounts summed. Totals don&apos;t
            change. Each client can override this in its billing settings.
          </span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Statement number format</span>
          <input
            name="statementNumberFormat"
            required
            maxLength={40}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            aria-describedby="number-format-hint"
            className="field font-mono text-[14px]"
          />
          <span id="number-format-hint" className={`mt-1 block text-[13px] ${check.ok ? "text-ink-3" : "text-loss-ink"}`}>
            {check.ok ? (
              <>
                Numbers look like <span className="num font-medium text-ink-2">{formatStatementNumber(format, year, 1)}</span>.{" "}
                {"{YYYY}"} or {"{YY}"} is the year, {"{NNNN}"} the counter; with a year it restarts every year. Assigned on the first close, never reused.
              </>
            ) : (
              check.reason
            )}
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Payment terms (days)</span>
          <input
            name="paymentTermsDays"
            type="number"
            inputMode="numeric"
            required
            min={0}
            max={365}
            step={1}
            defaultValue={numbering.paymentTermsDays}
            className="field num"
          />
          <span className="mt-1 block text-[13px] text-ink-3">Due date = issue date + these days. Clients can override it in their billing settings.</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save branding"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
    </form>
  );
}
