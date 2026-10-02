"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { alerts, budgets, clients, evaluateBudgets, projects } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

export type FormState = { ok?: string; error?: string } | undefined;

const budgetSchema = z
  .object({
    scope: z.enum(["org", "client", "project"]),
    clientId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    amountUsd: z.coerce.number().positive("Enter a monthly amount above zero.").max(10_000_000),
    thresholds: z
      .string()
      .transform((s) => [...new Set(s.split(/[,\s]+/).filter(Boolean).map(Number))].sort((a, b) => a - b))
      .pipe(z.array(z.number().int().min(1).max(1000)).min(1, "Add at least one threshold, like 50, 80, 100.")),
  })
  .refine((v) => v.scope !== "client" || v.clientId, { message: "Choose a client.", path: ["clientId"] })
  .refine((v) => v.scope !== "project" || v.projectId, { message: "Choose a project.", path: ["projectId"] });

const blank = (v: FormDataEntryValue | null) => (typeof v === "string" && v !== "" ? v : undefined);

export async function createBudget(_prev: FormState, form: FormData): Promise<FormState> {
  const org = await requireAdmin();
  const parsed = budgetSchema.safeParse({
    scope: form.get("scope"),
    clientId: blank(form.get("clientId")),
    projectId: blank(form.get("projectId")),
    amountUsd: form.get("amountUsd"),
    thresholds: String(form.get("thresholds") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const db = getDb();

  let clientId: string | null = null;
  let projectId: string | null = null;
  if (v.scope === "client") {
    const c = await db.query.clients.findFirst({ where: and(eq(clients.id, v.clientId!), eq(clients.orgId, org.id)) });
    if (!c) return { error: "That client no longer exists." };
    clientId = c.id;
  } else if (v.scope === "project") {
    const p = await db.query.projects.findFirst({ where: and(eq(projects.id, v.projectId!), eq(projects.orgId, org.id)) });
    if (!p) return { error: "That project no longer exists." };
    projectId = p.id;
    clientId = p.clientId;
  }

  await db.insert(budgets).values({
    orgId: org.id,
    scope: v.scope,
    clientId: v.scope === "org" ? null : clientId,
    projectId,
    amountUsd: String(v.amountUsd),
    thresholds: v.thresholds,
  });
  await evaluateBudgets(db, org.id);
  revalidatePath("/budgets");
  return { ok: "Budget created." };
}

export async function deleteBudget(form: FormData) {
  const org = await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  await getDb().delete(budgets).where(and(eq(budgets.id, id), eq(budgets.orgId, org.id)));
  revalidatePath("/budgets");
}

export async function acknowledgeAlert(form: FormData) {
  const org = await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  await getDb()
    .update(alerts)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(alerts.id, id), eq(alerts.orgId, org.id), isNull(alerts.acknowledgedAt)));
  revalidatePath("/", "layout");
}

export async function acknowledgeAll() {
  const org = await requireAdmin();
  await getDb()
    .update(alerts)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(alerts.orgId, org.id), isNull(alerts.acknowledgedAt)));
  revalidatePath("/", "layout");
}
