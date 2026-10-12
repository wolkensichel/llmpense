"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CURRENCIES } from "@llmpense/core";
import { fxRateOverrides, syncEcbRates } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

export type RateState = { ok?: string; error?: string } | undefined;

const overrideSchema = z.object({
  // USD is the accounting currency; it never needs a rate.
  currency: z.enum(CURRENCIES).refine((c) => c !== "USD", "USD needs no rate."),
  ratePerUsd: z.coerce
    .number({ message: "Enter the rate as a number, e.g. 0.92." })
    .positive("The rate must be above zero.")
    .max(1_000_000, "That rate is too large."),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date the rate applies from."),
  note: z.string().trim().max(200).optional(),
});

/** Adds (or replaces) a manual rate for a currency from a date. */
export async function addRateOverride(_prev: RateState, form: FormData): Promise<RateState> {
  const org = await requireAdmin();
  const parsed = overrideSchema.safeParse({
    currency: form.get("currency"),
    ratePerUsd: form.get("ratePerUsd"),
    effectiveFrom: form.get("effectiveFrom"),
    note: (form.get("note") as string | null) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  await getDb()
    .insert(fxRateOverrides)
    .values({ orgId: org.id, currency: v.currency, ratePerUsd: String(v.ratePerUsd), effectiveFrom: v.effectiveFrom, note: v.note ?? null })
    .onConflictDoUpdate({
      target: [fxRateOverrides.orgId, fxRateOverrides.currency, fxRateOverrides.effectiveFrom],
      set: { ratePerUsd: String(v.ratePerUsd), note: v.note ?? null },
    });
  revalidatePath("/", "layout");
  return { ok: `Manual rate saved: 1 USD = ${v.ratePerUsd} ${v.currency} from ${v.effectiveFrom}. Draft statements use it now; closed ones keep their rate.` };
}

export async function deleteRateOverride(form: FormData) {
  const org = await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  await getDb()
    .delete(fxRateOverrides)
    .where(and(eq(fxRateOverrides.id, id), eq(fxRateOverrides.orgId, org.id)));
  revalidatePath("/", "layout");
}

/** Fetches the ECB 90-day feed now. */
export async function syncRatesNow(_prev: RateState, _form: FormData): Promise<RateState> {
  await requireAdmin();
  try {
    const r = await syncEcbRates(getDb(), { feed: "90d", timeoutMs: 15_000 });
    revalidatePath("/", "layout");
    return { ok: `Fetched ${r.received} ECB reference rates, latest ${r.latestDate}.` };
  } catch (e) {
    return { error: `${(e as Error).message}. Stored and manual rates still apply.` };
  }
}
