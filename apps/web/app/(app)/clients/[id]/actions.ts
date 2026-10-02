"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { BILLING_MODES } from "@llmpense/core";
import { clients } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

export type BillingState = { ok?: string; error?: string } | undefined;

const schema = z.object({
  id: z.string().uuid(),
  billingMode: z.enum(BILLING_MODES),
  markupPct: z.coerce.number().min(0, "Markup can't be negative.").max(1000, "Markup is capped at 1000%."),
  fixedFeeUsd: z.coerce.number().min(0, "The fee can't be negative.").max(10_000_000),
});

export async function updateBilling(_prev: BillingState, form: FormData): Promise<BillingState> {
  const org = await requireAdmin();
  const parsed = schema.safeParse({
    id: form.get("id"),
    billingMode: form.get("billingMode"),
    markupPct: form.get("markupPct") || 0,
    fixedFeeUsd: form.get("fixedFeeUsd") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const updated = await getDb()
    .update(clients)
    .set({ billingMode: v.billingMode, markupPct: String(v.markupPct), fixedFeeUsd: String(v.fixedFeeUsd) })
    .where(and(eq(clients.id, v.id), eq(clients.orgId, org.id)))
    .returning({ id: clients.id });
  if (updated.length === 0) return { error: "That client no longer exists." };
  revalidatePath("/", "layout");
  return { ok: "Billing saved. New usage is billed with these settings." };
}
