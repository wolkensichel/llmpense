"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { PROVIDERS } from "@llmpense/core";
import { apiKeys, clients, generateApiKey, invalidatePriceCache, modelPrices, projects } from "@llmpense/db";
import { requireAdmin } from "@/lib/auth.ts";
import { getDb } from "@/lib/db.ts";

export type KeyState = { key?: string; name?: string; error?: string } | undefined;
export type PriceState = { ok?: string; error?: string } | undefined;

const blank = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

const keySchema = z.object({
  name: z.string().trim().min(1, "Give the key a name, like the app or server that uses it.").max(100),
  defaultClientId: z.string().uuid().optional(),
  defaultProjectId: z.string().uuid().optional(),
});

export async function createApiKey(_prev: KeyState, form: FormData): Promise<KeyState> {
  const org = await requireAdmin();
  const parsed = keySchema.safeParse({
    name: form.get("name") ?? "",
    defaultClientId: blank(form.get("defaultClientId")),
    defaultProjectId: blank(form.get("defaultProjectId")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const db = getDb();

  let clientId = v.defaultClientId ?? null;
  let projectId = v.defaultProjectId ?? null;
  if (projectId) {
    const p = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, org.id)) });
    if (!p) return { error: "That project no longer exists." };
    if (clientId && p.clientId !== clientId) return { error: "The default project must belong to the default client." };
    clientId = p.clientId;
  }
  if (clientId) {
    const c = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, org.id)) });
    if (!c) return { error: "That client no longer exists." };
  }

  const k = generateApiKey();
  await db.insert(apiKeys).values({
    orgId: org.id,
    name: v.name,
    prefix: k.prefix,
    hash: k.hash,
    defaultClientId: clientId,
    defaultProjectId: projectId,
  });
  revalidatePath("/settings");
  return { key: k.key, name: v.name };
}

export async function revokeApiKey(form: FormData) {
  const org = await requireAdmin();
  const id = z.string().uuid().parse(form.get("id"));
  await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, org.id), isNull(apiKeys.revokedAt)));
  revalidatePath("/settings");
}

const rate = z.coerce.number().min(0, "Rates can't be negative.").max(100_000);
const priceSchema = z.object({
  scope: z.enum(["org", "global"]),
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1, "Enter the model name exactly as the provider reports it.").max(200),
  inputPerMTok: rate,
  outputPerMTok: rate,
  cacheReadPerMTok: rate.optional(),
  cacheWritePerMTok: rate.optional(),
  effectiveFrom: z.coerce.date({ message: "Pick the date the price applies from." }),
  note: z.string().max(500).optional(),
});

export async function addPrice(_prev: PriceState, form: FormData): Promise<PriceState> {
  const org = await requireAdmin();
  const parsed = priceSchema.safeParse({
    scope: form.get("scope"),
    provider: form.get("provider"),
    model: form.get("model") ?? "",
    inputPerMTok: form.get("inputPerMTok"),
    outputPerMTok: form.get("outputPerMTok"),
    cacheReadPerMTok: blank(form.get("cacheReadPerMTok")),
    cacheWritePerMTok: blank(form.get("cacheWritePerMTok")),
    effectiveFrom: blank(form.get("effectiveFrom")),
    note: blank(form.get("note")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  await getDb().insert(modelPrices).values({
    orgId: v.scope === "org" ? org.id : null,
    provider: v.provider,
    model: v.model,
    inputPerMTok: String(v.inputPerMTok),
    outputPerMTok: String(v.outputPerMTok),
    cacheReadPerMTok: v.cacheReadPerMTok === undefined ? null : String(v.cacheReadPerMTok),
    cacheWritePerMTok: v.cacheWritePerMTok === undefined ? null : String(v.cacheWritePerMTok),
    effectiveFrom: v.effectiveFrom,
    note: v.note ?? null,
  });
  invalidatePriceCache();
  revalidatePath("/settings");
  return { ok: `Price saved for ${v.model}. It applies to requests recorded from now on.` };
}
