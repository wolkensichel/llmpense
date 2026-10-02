import "server-only";
import { and, asc, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alerts, apiKeys, budgets, clients, modelPrices, projects, usageEvents } from "@llmpense/db";
import type { BillingMode } from "@llmpense/core";
import { getDb } from "./db.ts";
import { clientMargin, dailyFixedFee, sumMargins, type MarginResult } from "./margin.ts";
import { eachDay, monthStartUtc, type DateRange } from "./range.ts";

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const num = (v: unknown) => Number(v ?? 0);

type Rows = Record<string, unknown>[];
async function rows(q: SQL): Promise<Rows> {
  return (await getDb().execute(q)) as unknown as Rows;
}

// ---------------------------------------------------------------- clients

export interface ClientInfo {
  id: string;
  name: string;
  slug: string;
  billingMode: BillingMode;
  markupPct: number;
  fixedFeeUsd: number;
  /** Stable categorical color slot (1-8) by creation order; 0 = "other". */
  slot: number;
}

export async function listClients(orgId: string): Promise<ClientInfo[]> {
  const list = await getDb()
    .select()
    .from(clients)
    .where(and(eq(clients.orgId, orgId), isNull(clients.archivedAt)))
    .orderBy(asc(clients.createdAt), asc(clients.name));
  return list.map((c, i) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    billingMode: c.billingMode,
    markupPct: num(c.markupPct),
    fixedFeeUsd: num(c.fixedFeeUsd),
    slot: i < 8 ? i + 1 : 0,
  }));
}

export async function getClient(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return (await listClients(orgId)).find((c) => c.id === id);
}

export async function listProjects(orgId: string) {
  return getDb()
    .select({ id: projects.id, name: projects.name, clientId: projects.clientId, clientName: clients.name })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.orgId, orgId), isNull(projects.archivedAt)))
    .orderBy(asc(clients.name), asc(projects.name));
}

// ---------------------------------------------------------------- margins

export interface ClientRow {
  client: ClientInfo | null;
  current: MarginResult & { requests: number; tokens: number };
  previous: MarginResult & { requests: number; tokens: number };
}

/** Per-client cost/billed/requests/tokens for the range and its comparison period, in one scan. */
export async function clientMargins(orgId: string, range: DateRange) {
  const [list, agg] = await Promise.all([
    listClients(orgId),
    rows(sql`
      select client_id,
        coalesce(sum(cost_usd) filter (where ts >= ${ts(range.start)}), 0) as cost,
        coalesce(sum(billed_usd) filter (where ts >= ${ts(range.start)}), 0) as billed,
        count(*) filter (where ts >= ${ts(range.start)}) as requests,
        coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)
          filter (where ts >= ${ts(range.start)}), 0) as tokens,
        coalesce(sum(cost_usd) filter (where ts < ${ts(range.prevEnd)}), 0) as prev_cost,
        coalesce(sum(billed_usd) filter (where ts < ${ts(range.prevEnd)}), 0) as prev_billed,
        count(*) filter (where ts < ${ts(range.prevEnd)}) as prev_requests,
        coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)
          filter (where ts < ${ts(range.prevEnd)}), 0) as prev_tokens
      from usage_events
      where org_id = ${orgId} and ts >= ${ts(range.prevStart)} and ts < ${ts(range.end)}
        and (ts >= ${ts(range.start)} or ts < ${ts(range.prevEnd)})
      group by client_id`),
  ]);
  const byId = new Map(agg.map((r) => [r.client_id as string | null, r]));

  const build = (client: ClientInfo | null, r: Record<string, unknown> | undefined): ClientRow => {
    const billingMode = client?.billingMode ?? null;
    const fixedFeeUsd = client?.fixedFeeUsd ?? 0;
    return {
      client,
      current: {
        ...clientMargin({ costUsd: num(r?.cost), billedUsd: num(r?.billed), billingMode, fixedFeeUsd, start: range.start, end: range.end }),
        requests: num(r?.requests),
        tokens: num(r?.tokens),
      },
      previous: {
        ...clientMargin({ costUsd: num(r?.prev_cost), billedUsd: num(r?.prev_billed), billingMode, fixedFeeUsd, start: range.prevStart, end: range.prevEnd }),
        requests: num(r?.prev_requests),
        tokens: num(r?.prev_tokens),
      },
    };
  };

  const clientRows = list.map((c) => build(c, byId.get(c.id)));
  const unattributedRaw = byId.get(null);
  const unattributed = unattributedRaw ? build(null, unattributedRaw) : null;
  const all = unattributed ? [...clientRows, unattributed] : clientRows;
  const totals = (k: "current" | "previous") => ({
    ...sumMargins(all.map((r) => r[k])),
    requests: all.reduce((a, r) => a + r[k].requests, 0),
    tokens: all.reduce((a, r) => a + r[k].tokens, 0),
  });
  const total = { current: totals("current"), previous: totals("previous") };
  return { clients: clientRows, unattributed, total };
}

/** Daily provider cost per client, pivoted into one row per day (missing days are zero). */
export async function dailyCostByClient(orgId: string, range: DateRange) {
  const r = await rows(sql`
    select to_char(ts at time zone 'UTC', 'YYYY-MM-DD') as day, client_id, sum(cost_usd) as cost
    from usage_events
    where org_id = ${orgId} and ts >= ${ts(range.start)} and ts < ${ts(range.end)}
    group by 1, 2`);
  const days = eachDay(range.start, range.end);
  const map = new Map(days.map((d) => [d, {} as Record<string, number>]));
  for (const x of r) {
    const bucket = map.get(x.day as string);
    if (bucket) bucket[(x.client_id as string | null) ?? "none"] = num(x.cost);
  }
  return days.map((day) => ({ day, ...map.get(day)! }));
}

// ---------------------------------------------------------------- client detail

export type Dimension = "project" | "model" | "feature";

export interface BreakdownRow {
  key: string;
  label: string;
  sub?: string;
  cost: number;
  billed: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
}

export async function clientBreakdown(orgId: string, clientId: string, range: DateRange, dim: Dimension) {
  const group =
    dim === "project"
      ? sql`coalesce(p.id::text, '-') as key, coalesce(p.name, 'No project') as label, null::text as sub`
      : dim === "model"
        ? sql`e.provider::text || '/' || e.model as key, e.model as label, e.provider::text as sub`
        : sql`coalesce(e.feature, '-') as key, coalesce(e.feature, 'No feature') as label, null::text as sub`;
  const r = await rows(sql`
    select ${group},
      sum(e.cost_usd) as cost, sum(e.billed_usd) as billed, count(*) as requests,
      sum(e.input_tokens) as input_tokens, sum(e.output_tokens) as output_tokens,
      sum(e.cache_read_tokens + e.cache_write_tokens) as cache_tokens
    from usage_events e
    left join projects p on p.id = e.project_id
    where e.org_id = ${orgId} and e.client_id = ${clientId}
      and e.ts >= ${ts(range.start)} and e.ts < ${ts(range.end)}
    group by 1, 2, 3
    order by cost desc`);
  return r.map(
    (x): BreakdownRow => ({
      key: String(x.key),
      label: String(x.label),
      sub: x.sub ? String(x.sub) : undefined,
      cost: num(x.cost),
      billed: num(x.billed),
      requests: num(x.requests),
      inputTokens: num(x.input_tokens),
      outputTokens: num(x.output_tokens),
      cacheTokens: num(x.cache_tokens),
    }),
  );
}

/** Daily cost per project plus daily revenue (billed + that day's share of the fixed fee). */
export async function clientDaily(orgId: string, client: ClientInfo, range: DateRange) {
  const r = await rows(sql`
    select to_char(ts at time zone 'UTC', 'YYYY-MM-DD') as day, project_id,
      sum(cost_usd) as cost, sum(billed_usd) as billed
    from usage_events
    where org_id = ${orgId} and client_id = ${client.id} and ts >= ${ts(range.start)} and ts < ${ts(range.end)}
    group by 1, 2`);
  const days = eachDay(range.start, range.end);
  const map = new Map(days.map((d) => [d, { cost: {} as Record<string, number>, billed: 0 }]));
  for (const x of r) {
    const b = map.get(x.day as string);
    if (!b) continue;
    b.cost[(x.project_id as string | null) ?? "none"] = num(x.cost);
    b.billed += num(x.billed);
  }
  return days.map((day) => {
    const b = map.get(day)!;
    const fee = client.billingMode === "fixed" ? dailyFixedFee(client.fixedFeeUsd, new Date(`${day}T00:00:00Z`)) : 0;
    return { day, ...b.cost, revenue: Math.round((b.billed + fee) * 100) / 100 };
  });
}

/** Invoice basis: one row per project and model for a calendar month. */
export async function clientMonthUsage(orgId: string, clientId: string, start: Date, end: Date) {
  const r = await rows(sql`
    select coalesce(p.name, 'No project') as project, e.provider::text as provider, e.model,
      count(*) as requests, sum(e.input_tokens) as input_tokens, sum(e.output_tokens) as output_tokens,
      sum(e.cache_read_tokens) as cache_read_tokens, sum(e.cache_write_tokens) as cache_write_tokens,
      sum(e.cost_usd) as cost, sum(e.billed_usd) as billed
    from usage_events e
    left join projects p on p.id = e.project_id
    where e.org_id = ${orgId} and e.client_id = ${clientId} and e.ts >= ${ts(start)} and e.ts < ${ts(end)}
    group by 1, 2, 3
    order by 1, 2, 3`);
  return r.map((x) => ({
    project: String(x.project),
    provider: String(x.provider),
    model: String(x.model),
    requests: num(x.requests),
    inputTokens: num(x.input_tokens),
    outputTokens: num(x.output_tokens),
    cacheReadTokens: num(x.cache_read_tokens),
    cacheWriteTokens: num(x.cache_write_tokens),
    cost: num(x.cost),
    billed: num(x.billed),
  }));
}

/** Months (YYYY-MM, newest first) in which a client has usage. */
export async function clientMonths(orgId: string, clientId: string) {
  const r = await rows(sql`
    select distinct to_char(ts at time zone 'UTC', 'YYYY-MM') as month
    from usage_events where org_id = ${orgId} and client_id = ${clientId}
    order by 1 desc limit 24`);
  return r.map((x) => String(x.month));
}

// ---------------------------------------------------------------- events

export interface EventFilters {
  client?: string;
  project?: string;
  model?: string;
  provider?: string;
  unpriced?: boolean;
  cursor?: number;
}

export const EVENTS_PAGE = 50;

export async function listEvents(orgId: string, range: DateRange, f: EventFilters) {
  const db = getDb();
  const conds: (SQL | undefined)[] = [
    eq(usageEvents.orgId, orgId),
    sql`${usageEvents.ts} >= ${ts(range.start)}`,
    sql`${usageEvents.ts} < ${ts(range.end)}`,
  ];
  if (f.client === "none") conds.push(isNull(usageEvents.clientId));
  else if (f.client) conds.push(eq(usageEvents.clientId, f.client));
  if (f.project) conds.push(eq(usageEvents.projectId, f.project));
  if (f.model) conds.push(eq(usageEvents.model, f.model));
  if (f.provider) conds.push(sql`${usageEvents.provider} = ${f.provider}`);
  if (f.unpriced) conds.push(eq(usageEvents.priced, false));
  if (f.cursor) conds.push(lt(usageEvents.id, f.cursor));

  const list = await db
    .select({
      id: usageEvents.id,
      ts: usageEvents.ts,
      provider: usageEvents.provider,
      model: usageEvents.model,
      clientId: usageEvents.clientId,
      clientName: clients.name,
      projectName: projects.name,
      feature: usageEvents.feature,
      inputTokens: usageEvents.inputTokens,
      outputTokens: usageEvents.outputTokens,
      cacheReadTokens: usageEvents.cacheReadTokens,
      cacheWriteTokens: usageEvents.cacheWriteTokens,
      costUsd: usageEvents.costUsd,
      billedUsd: usageEvents.billedUsd,
      priced: usageEvents.priced,
      latencyMs: usageEvents.latencyMs,
      status: usageEvents.status,
      source: usageEvents.source,
    })
    .from(usageEvents)
    .leftJoin(clients, eq(clients.id, usageEvents.clientId))
    .leftJoin(projects, eq(projects.id, usageEvents.projectId))
    .where(and(...conds))
    .orderBy(desc(usageEvents.id))
    .limit(EVENTS_PAGE + 1);
  const hasMore = list.length > EVENTS_PAGE;
  const page = list.slice(0, EVENTS_PAGE).map((e) => ({ ...e, costUsd: num(e.costUsd), billedUsd: num(e.billedUsd) }));
  return { events: page, nextCursor: hasMore ? page[page.length - 1]!.id : null };
}

export async function listModels(orgId: string) {
  const r = await rows(sql`
    select provider::text as provider, model, count(*) as n
    from usage_events where org_id = ${orgId}
    group by 1, 2 order by 1, 2`);
  return r.map((x) => ({ provider: String(x.provider), model: String(x.model) }));
}

// ---------------------------------------------------------------- budgets & alerts

export async function budgetsWithSpend(orgId: string, now = new Date()) {
  const start = monthStartUtc(now);
  const end = monthStartUtc(now, 1);
  const r = await rows(sql`
    select b.id, b.scope::text as scope, b.amount_usd, b.thresholds, b.client_id, b.project_id,
      c.name as client_name, p.name as project_name, pc.name as project_client_name,
      coalesce((
        select sum(e.cost_usd) from usage_events e
        where e.org_id = b.org_id and e.ts >= ${ts(start)} and e.ts < ${ts(end)}
          and (b.scope = 'org'
            or (b.scope = 'client' and e.client_id = b.client_id)
            or (b.scope = 'project' and e.project_id = b.project_id))
      ), 0) as spend
    from budgets b
    left join clients c on c.id = b.client_id
    left join projects p on p.id = b.project_id
    left join clients pc on pc.id = p.client_id
    where b.org_id = ${orgId}
    order by b.scope, b.created_at`);
  const elapsed = (Math.min(now.getTime(), end.getTime()) - start.getTime()) / (end.getTime() - start.getTime());
  return r.map((x) => {
    const spend = num(x.spend);
    const amount = num(x.amount_usd);
    const scope = String(x.scope) as "org" | "client" | "project";
    return {
      id: String(x.id),
      scope,
      name:
        scope === "org"
          ? "Whole agency"
          : scope === "client"
            ? String(x.client_name ?? "Deleted client")
            : `${x.project_client_name ?? ""} / ${x.project_name ?? "Deleted project"}`,
      clientId: (x.client_id as string | null) ?? null,
      amount,
      spend,
      thresholds: (x.thresholds as number[]) ?? [],
      pct: amount > 0 ? spend / amount : 0,
      projected: elapsed > 0 ? spend / elapsed : spend,
    };
  });
}

export async function listAlerts(orgId: string, opts: { unacknowledgedOnly?: boolean; limit?: number } = {}) {
  const db = getDb();
  const p2 = projects;
  return db
    .select({
      id: alerts.id,
      threshold: alerts.threshold,
      periodStart: alerts.periodStart,
      spendUsd: alerts.spendUsd,
      acknowledgedAt: alerts.acknowledgedAt,
      createdAt: alerts.createdAt,
      scope: budgets.scope,
      amountUsd: budgets.amountUsd,
      clientId: budgets.clientId,
      clientName: clients.name,
      projectName: p2.name,
    })
    .from(alerts)
    .innerJoin(budgets, eq(budgets.id, alerts.budgetId))
    .leftJoin(clients, eq(clients.id, budgets.clientId))
    .leftJoin(p2, eq(p2.id, budgets.projectId))
    .where(and(eq(alerts.orgId, orgId), opts.unacknowledgedOnly ? isNull(alerts.acknowledgedAt) : undefined))
    .orderBy(desc(alerts.createdAt), desc(alerts.threshold))
    .limit(opts.limit ?? 100);
}

// ---------------------------------------------------------------- settings

export async function listApiKeys(orgId: string) {
  return getDb()
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
      clientName: clients.name,
      projectName: projects.name,
    })
    .from(apiKeys)
    .leftJoin(clients, eq(clients.id, apiKeys.defaultClientId))
    .leftJoin(projects, eq(projects.id, apiKeys.defaultProjectId))
    .where(eq(apiKeys.orgId, orgId))
    .orderBy(asc(apiKeys.revokedAt), desc(apiKeys.createdAt));
}

export async function listPriceOverrides(orgId: string) {
  return getDb()
    .select()
    .from(modelPrices)
    .where(or(isNull(modelPrices.orgId), eq(modelPrices.orgId, orgId)))
    .orderBy(asc(modelPrices.provider), asc(modelPrices.model), desc(modelPrices.effectiveFrom));
}

export async function unpricedCount(orgId: string, range: DateRange) {
  const r = await rows(sql`
    select count(*) as n from usage_events
    where org_id = ${orgId} and not priced and ts >= ${ts(range.start)} and ts < ${ts(range.end)}`);
  return num(r[0]?.n);
}
