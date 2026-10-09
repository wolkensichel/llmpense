"use client";

import { useActionState } from "react";
import type { Branding } from "@/lib/branding.ts";
import { saveBranding } from "./branding-actions.ts";

export function BrandingForm({ branding }: { branding: Branding }) {
  const [state, action, pending] = useActionState(saveBranding, undefined);
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
