"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { orgs } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { accountingSchema } from "@/lib/accounting/settings.ts";

export type AccountingState = { ok?: string; error?: string } | undefined;

const FIELDS = [
  "xeroAccountCode",
  "xeroTaxType",
  "datevConsultantNumber",
  "datevClientNumber",
  "datevAccountLength",
  "datevFiscalYearStart",
  "datevRevenueAccount",
  "datevDebtorAccount",
  "datevTaxKey",
] as const;

export async function saveAccountingSettings(_prev: AccountingState, form: FormData): Promise<AccountingState> {
  const org = await requireAdmin();
  const parsed = accountingSchema.safeParse(Object.fromEntries(FIELDS.map((f) => [f, form.get(f) ?? undefined])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  await getDb().update(orgs).set(parsed.data).where(eq(orgs.id, org.id));
  revalidatePath("/", "layout");
  return { ok: "Accounting export settings saved." };
}
