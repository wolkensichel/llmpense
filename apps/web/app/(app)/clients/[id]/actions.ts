"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BILLING_MODES, CURRENCIES, MODEL_NAME_DISPLAY, roundMinor } from "@llmpense/core";
import { clients, evaluateFixedFeeLosses } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

export type BillingState = { ok?: string; error?: string } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  billingMode: z.enum(BILLING_MODES),
  billingCurrency: z.enum(CURRENCIES, { message: "Pick a billing currency." }),
  markupPct: z.coerce.number().min(0, "Markup can't be negative.").max(1000, "Markup is capped at 1000%."),
  fixedFee: z.coerce.number().min(0, "The fee can't be negative.").max(10_000_000_000),
  modelNames: z.enum(MODEL_NAME_DISPLAY).nullable(),
});

export async function updateBilling(_prev: BillingState, form: FormData): Promise<BillingState> {
  const org = await requireAdmin();
  const parsed = schema.safeParse({
    id: form.get("id"),
    billingMode: form.get("billingMode"),
    billingCurrency: form.get("billingCurrency") ?? "USD",
    markupPct: form.get("markupPct") || 0,
    fixedFee: form.get("fixedFee") || 0,
    modelNames: form.get("modelNames") || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const updated = await getDb()
    .update(clients)
    .set({
      billingMode: v.billingMode,
      billingCurrency: v.billingCurrency,
      markupPct: String(v.markupPct),
      // Stored in the currency's minor unit (whole yen).
      fixedFee: String(roundMinor(v.fixedFee, v.billingCurrency)),
      modelNames: v.modelNames,
    })
    .where(and(eq(clients.id, v.id), eq(clients.orgId, org.id)))
    .returning({ id: clients.id });
  if (updated.length === 0) return { error: "That client no longer exists." };
  await evaluateFixedFeeLosses(getDb(), org.id);
  revalidatePath("/", "layout");
  return { ok: "Billing saved. New usage and draft statements use these settings." };
}
