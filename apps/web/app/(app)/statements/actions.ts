"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { closeAllDrafts, closeStatement, markStatement, markStatements, reopenStatement } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { ensureFreshRates } from "@/lib/fx.ts";

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const one = z.object({ clientId: z.string().uuid(), period });
const markAction = z.enum(["mark_sent", "mark_paid", "unmark_sent", "unmark_paid"]);
/** Optional issue date (YYYY-MM-DD) when marking as sent; empty keeps the close date. */
const issueDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

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

/** Marks one statement as sent or paid, or unmarks it (one step back). */
export async function markStatementAction(form: FormData) {
  const org = await requireAdmin();
  const v = one.extend({ action: markAction, issueDate }).parse({
    clientId: form.get("clientId"),
    period: form.get("period"),
    action: form.get("action"),
    issueDate: form.get("issueDate"),
  });
  await markStatement(getDb(), org.id, v.clientId, v.period, v.action, { issueDate: v.action === "mark_sent" ? v.issueDate : null });
  revalidatePath("/", "layout");
}

/** Marks the selected statements of a month as sent or paid; others are skipped. */
export async function markSelectedAction(form: FormData) {
  const org = await requireAdmin();
  const v = z
    .object({ period, action: z.enum(["mark_sent", "mark_paid"]), clientIds: z.array(z.string().uuid()).max(1000), issueDate })
    .parse({
      period: form.get("period"),
      action: form.get("action"),
      clientIds: form.getAll("clientId"),
      issueDate: form.get("issueDate"),
    });
  await markStatements(getDb(), org.id, v.period, v.clientIds, v.action, { issueDate: v.action === "mark_sent" ? v.issueDate : null });
  revalidatePath("/", "layout");
}
