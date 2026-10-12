"use client";

import { useActionState } from "react";
import type { AccountingSettings } from "@/lib/accounting/settings.ts";
import { saveAccountingSettings } from "./accounting-export-actions.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Field({
  name,
  label,
  hint,
  defaultValue,
  inputMode,
  placeholder,
  maxLength,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue: string | number | null;
  inputMode?: "numeric" | "text";
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        inputMode={inputMode}
        pattern={inputMode === "numeric" ? "[0-9]*" : undefined}
        placeholder={placeholder}
        maxLength={maxLength}
        spellCheck={false}
        autoComplete="off"
        className={`field ${inputMode === "numeric" ? "num" : ""}`}
      />
      {hint && <span className="mt-1 block text-[13px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function AccountingExportForm({ settings: s }: { settings: AccountingSettings }) {
  const [state, action, pending] = useActionState(saveAccountingSettings, undefined);
  return (
    <form action={action} className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Xero</legend>
        <p className="text-[13px] text-ink-3">
          Sales invoice CSV for Sales &gt; Invoices &gt; Import. Both values must match Xero exactly; invoices import as drafts.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="xeroAccountCode" label="Account code" placeholder="e.g. 200" maxLength={10} defaultValue={s.xeroAccountCode} hint="Revenue account from your chart of accounts." />
          <Field name="xeroTaxType" label="Tax rate" placeholder="e.g. Tax Exempt" maxLength={50} defaultValue={s.xeroTaxType} hint="Display name as in tax settings, e.g. 20% (VAT on Income)." />
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-line pt-4">
        <legend className="float-left mb-1 w-full text-sm font-semibold">DATEV</legend>
        <p className="clear-left text-[13px] text-ink-3">
          Buchungsstapel (EXTF) for DATEV Rechnungswesen: one posting per statement from the debtor account to the revenue account. Agree the
          accounts and tax key with your tax advisor.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="datevConsultantNumber" label="Consultant number (Beraternummer)" inputMode="numeric" maxLength={7} placeholder="e.g. 29098" defaultValue={s.datevConsultantNumber} />
          <Field name="datevClientNumber" label="Client number (Mandantennummer)" inputMode="numeric" maxLength={5} placeholder="e.g. 55003" defaultValue={s.datevClientNumber} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">G/L account length</span>
            <select name="datevAccountLength" defaultValue={s.datevAccountLength} className="field num">
              {[4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n} digits
                </option>
              ))}
            </select>
          </label>
          <Field name="datevRevenueAccount" label="Revenue account (Erlöskonto)" inputMode="numeric" maxLength={9} placeholder="e.g. 8400" defaultValue={s.datevRevenueAccount} />
          <Field name="datevDebtorAccount" label="Debtor account (Debitor)" inputMode="numeric" maxLength={9} placeholder="e.g. 10000" defaultValue={s.datevDebtorAccount} />
          <Field
            name="datevTaxKey"
            label="Tax key (BU-Schlüssel, optional)"
            inputMode="numeric"
            maxLength={4}
            defaultValue={s.datevTaxKey}
            hint="Leave empty for revenue accounts with automatic tax."
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Fiscal year starts in</span>
            <select name="datevFiscalYearStart" defaultValue={s.datevFiscalYearStart} className="field">
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <p className="border-t border-line pt-4 text-[13px] text-ink-3">
        Lexware Office (lexoffice) has no file import for sales invoices; upload the statement PDFs in its receipt capture instead.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save export settings"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
    </form>
  );
}
