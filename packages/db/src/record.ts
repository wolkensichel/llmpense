import { and, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import {
  billedAmount,
  computeCost,
  findPrice,
  loadBundledPrices,
  type PriceRow,
  type Provider,
  type UsageEventInput,
} from "@llmpense/core";
import type { Db } from "./client.ts";
import { alerts, budgets, clients, modelPrices, projects, usageEvents } from "./schema.ts";

export interface RecordContext {
  orgId: string;
  source: "proxy" | "ingest" | "seed";
  apiKeyId?: string | null;
  defaultClientId?: string | null;
  defaultProjectId?: string | null;
}

export interface RecordExtras {
  streamed?: boolean;
}

const bundled = loadBundledPrices();
const PRICE_TTL_MS = 60_000;
const priceCache = new Map<string, { at: number; rows: CachedPrice[] }>();

type CachedPrice = PriceRow & { orgOverride: boolean };

/** DB price rows for an org (org overrides and global rows), cached for a minute. */
async function dbPrices(db: Db, orgId: string): Promise<{ org: PriceRow[]; global: PriceRow[] }> {
  let rows = priceCache.get(orgId);
  if (!rows || Date.now() - rows.at >= PRICE_TTL_MS) {
    const raw = await db
      .select()
      .from(modelPrices)
      .where(or(isNull(modelPrices.orgId), eq(modelPrices.orgId, orgId)));
    rows = {
      at: Date.now(),
      rows: raw.map((r) => ({
        provider: r.provider,
        model: r.model,
        inputPerMTok: Number(r.inputPerMTok),
        outputPerMTok: Number(r.outputPerMTok),
        cacheReadPerMTok: r.cacheReadPerMTok === null ? null : Number(r.cacheReadPerMTok),
        cacheWritePerMTok: r.cacheWritePerMTok === null ? null : Number(r.cacheWritePerMTok),
        effectiveFrom: r.effectiveFrom,
        orgOverride: r.orgId !== null,
      })),
    };
    priceCache.set(orgId, rows);
  }
  return { org: rows.rows.filter((r) => r.orgOverride), global: rows.rows.filter((r) => !r.orgOverride) };
}

export function invalidatePriceCache() {
  priceCache.clear();
}

/** Org override -> global DB row -> bundled snapshot. */
export async function resolvePrice(db: Db, orgId: string, provider: Provider, model: string, at: Date) {
  const { org, global } = await dbPrices(db, orgId);
  return findPrice(org, provider, model, at) ?? findPrice(global, provider, model, at) ?? findPrice(bundled, provider, model, at);
}

/**
 * Prices, attributes and stores usage events, then evaluates budgets.
 * Client/project are given as slugs; unknown slugs are auto-created so that
 * adding a header in client code is all it takes to start tracking a new client.
 * Duplicate (provider, requestId) pairs are ignored.
 */
export async function recordEvents(db: Db, ctx: RecordContext, events: (UsageEventInput & RecordExtras)[]) {
  if (events.length === 0) return { inserted: 0 };

  const clientCache = new Map<string, typeof clients.$inferSelect>();
  const projectCache = new Map<string, string>();

  const rows: (typeof usageEvents.$inferInsert)[] = [];
  for (const e of events) {
    const ts = e.ts ?? new Date();

    let client: typeof clients.$inferSelect | undefined;
    if (e.client) {
      client = clientCache.get(e.client) ?? (await upsertClient(db, ctx.orgId, e.client));
      clientCache.set(e.client, client);
    } else if (ctx.defaultClientId) {
      client = await db.query.clients.findFirst({ where: eq(clients.id, ctx.defaultClientId) });
    }

    let projectId: string | null = null;
    if (client && e.project) {
      const k = `${client.id}/${e.project}`;
      projectId = projectCache.get(k) ?? (await upsertProject(db, ctx.orgId, client.id, e.project));
      projectCache.set(k, projectId);
    } else if (!e.client && ctx.defaultProjectId) {
      projectId = ctx.defaultProjectId;
    }

    const usage = {
      inputTokens: e.inputTokens ?? 0,
      outputTokens: e.outputTokens ?? 0,
      cacheReadTokens: e.cacheReadTokens ?? 0,
      cacheWriteTokens: e.cacheWriteTokens ?? 0,
    };
    let costUsd = e.costUsd;
    let priced = true;
    if (costUsd === undefined) {
      const price = await resolvePrice(db, ctx.orgId, e.provider, e.model, ts);
      priced = !!price;
      costUsd = price ? computeCost(usage, price) : 0;
    }
    const billed = client
      ? billedAmount(costUsd, { billingMode: client.billingMode, markupPct: Number(client.markupPct) })
      : 0;

    rows.push({
      orgId: ctx.orgId,
      ts,
      source: ctx.source,
      provider: e.provider,
      model: e.model,
      requestId: e.requestId ?? null,
      apiKeyId: ctx.apiKeyId ?? null,
      clientId: client?.id ?? null,
      projectId,
      feature: e.feature ?? null,
      endUser: e.endUser ?? null,
      ...usage,
      costUsd: String(costUsd),
      billedUsd: String(billed),
      priced,
      latencyMs: e.latencyMs ?? null,
      status: e.status ?? null,
      streamed: e.streamed ?? false,
      outcome: e.outcome ?? null,
      metadata: e.metadata ?? null,
    });
  }

  const inserted = await db
    .insert(usageEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: usageEvents.id });

  if (ctx.source !== "seed") await evaluateBudgets(db, ctx.orgId);
  return { inserted: inserted.length };
}

async function upsertClient(db: Db, orgId: string, slug: string) {
  const s = slugify(slug);
  const [row] = await db
    .insert(clients)
    .values({ orgId, slug: s, name: slug })
    .onConflictDoUpdate({ target: [clients.orgId, clients.slug], set: { slug: s } })
    .returning();
  return row!;
}

async function upsertProject(db: Db, orgId: string, clientId: string, slug: string) {
  const s = slugify(slug);
  const [row] = await db
    .insert(projects)
    .values({ orgId, clientId, slug: s, name: slug })
    .onConflictDoUpdate({ target: [projects.clientId, projects.slug], set: { slug: s } })
    .returning({ id: projects.id });
  return row!.id;
}

export function slugify(s: string) {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100) || "unknown"
  );
}

export function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Fires an alert row once per budget, threshold and month when spend crosses it. */
export async function evaluateBudgets(db: Db, orgId: string, at = new Date()) {
  const all = await db.select().from(budgets).where(eq(budgets.orgId, orgId));
  if (all.length === 0) return [];
  const start = monthStart(at);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const periodStart = start.toISOString().slice(0, 10);
  const fired: (typeof alerts.$inferSelect)[] = [];

  for (const b of all) {
    const scope =
      b.scope === "client" && b.clientId
        ? eq(usageEvents.clientId, b.clientId)
        : b.scope === "project" && b.projectId
          ? eq(usageEvents.projectId, b.projectId)
          : undefined;
    const [row] = await db
      .select({ spend: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)` })
      .from(usageEvents)
      .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.ts, start), lt(usageEvents.ts, end), scope));
    const spend = Number(row?.spend ?? 0);
    const pct = (spend / Number(b.amountUsd)) * 100;
    const crossed = b.thresholds.filter((t) => pct >= t);
    if (crossed.length === 0) continue;
    const created = await db
      .insert(alerts)
      .values(crossed.map((threshold) => ({ orgId, budgetId: b.id, threshold, periodStart, spendUsd: String(spend) })))
      .onConflictDoNothing()
      .returning();
    fired.push(...created);
  }
  return fired;
}

