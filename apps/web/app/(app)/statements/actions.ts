"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { closeAllDrafts, closeStatement, reopenStatement } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { ensureFreshRates } from "@/lib/fx.ts";

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const one = z.object({ clientId: z.string().uuid(), period });

export async function closeStatementAction(form: FormData) {
  const org = await requireAdmin();
  const v = one.parse({ clientId: form.get("clientId"), period: form.get("period") });
  await ensureFreshRates();
  await closeStatement(getDb(), org.id, v.clientId, v.period);
  revalidatePath("/", "layout");
}

export async function reopenStatementAction(form: FormData) {
  const org = await requireAdmin();
  const v = one.parse({ clientId: form.get("clientId"), period: form.get("period") });
  await reopenStatement(getDb(), org.id, v.clientId, v.period);
  revalidatePath("/", "layout");
}

export async function closeAllDraftsAction(form: FormData) {
  const org = await requireAdmin();
  const p = period.parse(form.get("period"));
  await ensureFreshRates();
  await closeAllDrafts(getDb(), org.id, p);
  revalidatePath("/", "layout");
}
