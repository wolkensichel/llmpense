"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { closeAllDrafts, closeStatement, markStatement, markStatements, reopenStatement } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";
import { ensureRatesFor } from "@/lib/fx.ts";

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const one = z.object({ clientId: z.string().uuid(), period });
const markAction = z.enum(["mark_sent", "mark_paid", "unmark_sent", "unmark_paid"]);
/** Optional issue date when marking as sent; empty keeps the close date. The db layer validates it. */
const issueDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().max(32).optional());

/** Closing downloads older exchange rates when needed, so it waits longer than a page does. */
const CLOSE_RATE_WAIT_MS = 20_000;

const statementPath = (clientId: string, period: string) => `/clients/${clientId}/statements/${period}`;
/** Sends the user back with a message; see lib/statement-notice.ts. */
const notify = (path: string, params: Record<string, string | number>): never => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  redirect(`${path}${path.includes("?") ? "&" : "?"}${q}`);
};

export async function closeStatementAction(form: FormData) {
  const org = await requireAdmin();
  const v = one.parse({ clientId: form.get("clientId"), period: form.get("period") });
  await ensureRatesFor([v.period], new Date(), CLOSE_RATE_WAIT_MS);
  const r = await closeStatement(getDb(), org.id, v.clientId, v.period);
  revalidatePath("/", "layout");
  const path = statementPath(v.clientId, v.period);
  if (r === "no_rate") notify(path, { notice: "no-rate" });
  if (r === "not_ended") notify(path, { notice: "not-ended" });
  if (r === "not_found" || r === "already_closed") notify(path, { notice: "not-allowed" });
}

export async function reopenStatementAction(form: FormData) {
  const org = await requireAdmin();
  const v = one.parse({ clientId: form.get("clientId"), period: form.get("period") });
  const r = await reopenStatement(getDb(), org.id, v.clientId, v.period);
  revalidatePath("/", "layout");
  if (r !== "reopened") notify(statementPath(v.clientId, v.period), { notice: "not-allowed" });
}

export async function closeAllDraftsAction(form: FormData) {
  const org = await requireAdmin();
  const p = period.parse(form.get("period"));
  await ensureRatesFor([p], new Date(), CLOSE_RATE_WAIT_MS);
  const r = await closeAllDrafts(getDb(), org.id, p);
  revalidatePath("/", "layout");
  if (r.noRate > 0) notify(`/statements?month=${p}`, { notice: "close-partial", closed: r.closed, noRate: r.noRate });
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
  const r = await markStatement(getDb(), org.id, v.clientId, v.period, v.action, { issueDate: v.action === "mark_sent" ? v.issueDate : null });
  revalidatePath("/", "layout");
  if (r === "invalid_date") notify(statementPath(v.clientId, v.period), { notice: "invalid-date" });
  if (r !== "done") notify(statementPath(v.clientId, v.period), { notice: "not-allowed" });
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
  const r = await markStatements(getDb(), org.id, v.period, v.clientIds, v.action, { issueDate: v.action === "mark_sent" ? v.issueDate : null });
  revalidatePath("/", "layout");
  const path = `/statements?month=${v.period}`;
  if (r.invalidDate) notify(path, { notice: "invalid-date" });
  if (r.skipped > 0) notify(path, { notice: "skipped", done: r.done, skipped: r.skipped });
}
