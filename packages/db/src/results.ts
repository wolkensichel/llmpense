/**
 * Outcomes and cost per result. Outcomes are stored per (org, run id, name); usage events carry
 * the run id. The two are joined by run id at query time, so outcomes may arrive before or after
 * the run's usage.
 */
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  resultMetrics,
  valuesToUsd,
  type Currency,
  type EurRate,
  type OutcomeInput,
  type ResultMetrics,
  type ValueSum,
} from "@llmpense/core";
import type { Db } from "./client.ts";
import { listRateOverrides } from "./fx.ts";
import { clients, fxRates, outcomes, projects } from "./schema.ts";

// ---------------------------------------------------------------- writing

/**
 * Inserts or updates outcomes (idempotent per run id and name). Within one batch the last
 * report for a (run id, name) wins. An update without `ts` keeps the stored timestamp.
 * Returns the number of distinct outcomes written.
 */
export async function upsertOutcomes(db: Db, orgId: string, input: readonly OutcomeInput[], now = new Date()): Promise<number> {
  const byKey = new Map<string, OutcomeInput>();
  for (const o of input) {
    const k = JSON.stringify([o.runId, o.name]);
    byKey.delete(k);
    byKey.set(k, o);
  }
  const all = [...byKey.values()];
  const row = (o: OutcomeInput) => ({
    orgId,
    runId: o.runId,
    name: o.name,
    status: o.status,
    valueAmount: o.value ? String(o.value.amount) : null,
    valueCurrency: o.value?.currency ?? null,
    ts: o.ts ?? now,
    metadata: o.metadata ?? null,
    updatedAt: now,
  });
  const common = {
    status: sql`excluded.status`,
    valueAmount: sql`excluded.value_amount`,
    valueCurrency: sql`excluded.value_currency`,
    metadata: sql`excluded.metadata`,
    updatedAt: sql`excluded.updated_at`,
  };
  const target = [outcomes.orgId, outcomes.runId, outcomes.name];
  let written = 0;
  for (const withTs of [true, false]) {
    const part = all.filter((o) => (o.ts !== undefined) === withTs);
    for (let i = 0; i < part.length; i += 500) {
      const done = await db
        .insert(outcomes)
        .values(part.slice(i, i + 500).map(row))
        .onConflictDoUpdate({ target, set: withTs ? { ...common, ts: sql`excluded.ts` } : common })
        .returning({ id: outcomes.id });
      written += done.length;
    }
  }
  return written;
}

// ---------------------------------------------------------------- reading

/** Breakdown of an outcome's runs. A run counts under a client, project or model only when all its calls share it. */
export type ResultDimension = "client" | "project" | "model" | "day";

export interface ResultScope {
  orgId: string;
  /** Outcome timestamps in [start, end). */
  start: Date;
  end: Date;
  /** One outcome name, or all. */
  name?: string;
  /** Only runs whose calls all belong to this client. */
  clientId?: string;
}

/** Bucket key for runs whose calls span several clients, projects or models. */
export const MIXED_KEY = "*";
/** Bucket key for runs without a client or project. */
export const NONE_KEY = "";

export interface ResultBucket extends ResultMetrics {
  name: string;
  /** Dimension value: an id, `provider/model`, a day, MIXED_KEY, NONE_KEY, or null for runs without usage. */
  key: string | null;
  label: string;
  sub?: string;
  runsWithoutUsage: number;
  /** Value sums in a currency without a known rate (left out of value per dollar). */
  missingRates: number;
}

type Rows = Record<string, unknown>[];
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const num = (v: unknown) => Number(v ?? 0);

async function rows(db: Db, q: SQL): Promise<Rows> {
  return (await db.execute(q)) as unknown as Rows;
}

/** One value per run for a dimension: the shared value, or MIXED_KEY when the run's calls differ. */
const single = (expr: SQL) => sql`case when count(distinct ${expr}) = 1 then min(${expr}) else ${MIXED_KEY} end`;

/** Outcomes in scope (o) and per-run cost and attribution of their runs (r). */
function scopeCte(s: ResultScope): SQL {
  return sql`
    with o as (
      select run_id, name, status, value_amount, value_currency, ts
      from outcomes
      where org_id = ${s.orgId} and ts >= ${ts(s.start)} and ts < ${ts(s.end)}
        ${s.name !== undefined ? sql`and name = ${s.name}` : sql``}
    ),
    r as (
      select e.run_id,
        sum(e.cost_usd) as cost,
        ${single(sql`coalesce(e.client_id::text, ${NONE_KEY})`)} as client_key,
        ${single(sql`coalesce(e.project_id::text, ${NONE_KEY})`)} as project_key,
        ${single(sql`e.provider::text || '/' || e.model`)} as model_key
      from usage_events e
      where e.org_id = ${s.orgId} and e.run_id is not null and e.run_id in (select run_id from o)
      group by e.run_id
    )`;
}

function keyExpr(dim: ResultDimension | undefined): SQL {
  switch (dim) {
    case "client":
      return sql`r.client_key`;
    case "project":
      return sql`r.project_key`;
    case "model":
      return sql`r.model_key`;
    case "day":
      return sql`to_char(o.ts at time zone 'UTC', 'YYYY-MM-DD')`;
    default:
      return sql`${NONE_KEY}::text`;
  }
}

const clientFilter = (s: ResultScope) => (s.clientId ? sql`where r.client_key = ${s.clientId}` : sql``);
const andClient = (s: ResultScope) => (s.clientId ? sql`and r.client_key = ${s.clientId}` : sql``);

/** Raw SQL aggregates: counts and cost per (name, key), and success values per (name, key, currency, day). */
export async function outcomeAggregates(db: Db, s: ResultScope, dim?: ResultDimension) {
  const cte = scopeCte(s);
  const key = keyExpr(dim);
  const [counts, values] = await Promise.all([
    rows(
      db,
      sql`${cte}
      select o.name, ${key} as key,
        count(*) as runs,
        count(*) filter (where o.status = 'success') as successes,
        count(*) filter (where o.status = 'failure') as failures,
        count(*) filter (where r.run_id is null) as no_usage,
        coalesce(sum(r.cost), 0) as cost
      from o left join r on r.run_id = o.run_id
      ${clientFilter(s)}
      group by 1, 2`,
    ),
    rows(
      db,
      sql`${cte}
      select o.name, ${key} as key, o.value_currency::text as currency,
        to_char(o.ts at time zone 'UTC', 'YYYY-MM-DD') as day, sum(o.value_amount) as amount
      from o left join r on r.run_id = o.run_id
      where o.status = 'success' and o.value_amount is not null ${andClient(s)}
      group by 1, 2, 3, 4`,
    ),
  ]);
  return {
    counts: counts.map((x) => ({
      name: String(x.name),
      key: x.key === null ? null : String(x.key),
      runs: num(x.runs),
      successes: num(x.successes),
      failures: num(x.failures),
      runsWithoutUsage: num(x.no_usage),
      costUsd: num(x.cost),
    })),
    values: values.map((x) => ({
      name: String(x.name),
      key: x.key === null ? null : String(x.key),
      currency: String(x.currency) as Currency,
      day: String(x.day),
      amount: num(x.amount),
    })),
  };
}

/**
 * Reference rates for days `from` to `to` (YYYY-MM-DD): every rate in between plus the last ten
 * rate dates before `from`, so the first days can fall back over weekends, holidays or gaps.
 */
export async function loadEurRatesBetween(db: Db, from: string, to: string): Promise<EurRate[]> {
  const earlier = await db
    .select({ date: fxRates.date })
    .from(fxRates)
    .where(and(eq(fxRates.currency, "USD"), lte(fxRates.date, from)))
    .orderBy(desc(fxRates.date))
    .limit(10);
  const back = earlier.at(-1)?.date ?? from;
  const r = await db
    .select()
    .from(fxRates)
    .where(and(gte(fxRates.date, back), lte(fxRates.date, to)));
  return r.map((x) => ({ date: x.date, currency: x.currency, ratePerEur: Number(x.ratePerEur), source: x.source }));
}

async function labels(db: Db, orgId: string, dim: ResultDimension | undefined) {
  const out = new Map<string, { label: string; sub?: string }>();
  if (dim === "client") {
    for (const c of await db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.orgId, orgId))) {
      out.set(c.id, { label: c.name });
    }
  } else if (dim === "project") {
    const list = await db
      .select({ id: projects.id, name: projects.name, client: clients.name })
      .from(projects)
      .innerJoin(clients, eq(clients.id, projects.clientId))
      .where(eq(projects.orgId, orgId));
    for (const p of list) out.set(p.id, { label: p.name, sub: p.client });
  }
  return out;
}

function labelFor(dim: ResultDimension | undefined, key: string | null, names: Map<string, { label: string; sub?: string }>) {
  if (key === null) return { label: "No usage recorded yet" };
  if (key === MIXED_KEY) return { label: dim === "client" ? "Several clients" : dim === "project" ? "Several projects" : "Several models" };
  if (key === NONE_KEY) return { label: dim === "project" ? "No project" : dim === "client" ? "Unattributed" : "All" };
  if (dim === "model") {
    const i = key.indexOf("/");
    return { label: key.slice(i + 1), sub: key.slice(0, i) };
  }
  return names.get(key) ?? { label: dim === "day" ? key : "Deleted" };
}

/**
 * Metrics per outcome name and dimension value, with success values converted to USD at the
 * rate of each outcome's day. Buckets are sorted by runs, most first.
 */
export async function resultBuckets(db: Db, s: ResultScope, dim?: ResultDimension): Promise<ResultBucket[]> {
  const { counts, values } = await outcomeAggregates(db, s, dim);
  if (counts.length === 0) return [];
  const days = values.map((v) => v.day).sort();
  const needRates = values.some((v) => v.currency !== "USD");
  const [rates, overrides, names] = await Promise.all([
    needRates ? loadEurRatesBetween(db, days[0]!, days.at(-1)!) : Promise.resolve([]),
    needRates ? listRateOverrides(db, s.orgId) : Promise.resolve([]),
    labels(db, s.orgId, dim),
  ]);
  const ov = overrides.map((o) => ({ currency: o.currency, perUsd: Number(o.ratePerUsd), effectiveFrom: o.effectiveFrom }));
  const valuesOf = new Map<string, ValueSum[]>();
  for (const v of values) {
    const k = JSON.stringify([v.name, v.key]);
    valuesOf.set(k, [...(valuesOf.get(k) ?? []), v]);
  }
  return counts
    .map((c) => {
      const conv = valuesToUsd(valuesOf.get(JSON.stringify([c.name, c.key])) ?? [], rates, ov);
      return {
        ...resultMetrics({ ...c, successValueUsd: conv.usd }),
        runsWithoutUsage: c.runsWithoutUsage,
        name: c.name,
        key: c.key,
        ...labelFor(dim, c.key, names),
        missingRates: conv.missingRates,
      };
    })
    .sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));
}

/**
 * Runs whose most recent call falls in [start, end) and that have no outcome of any name yet:
 * their cost is already spent while the result is pending.
 */
export async function pendingRuns(db: Db, s: Omit<ResultScope, "name">): Promise<{ runs: number; costUsd: number }> {
  const [r] = await rows(
    db,
    sql`
    with cand as (
      select distinct run_id from usage_events
      where org_id = ${s.orgId} and run_id is not null and ts >= ${ts(s.start)} and ts < ${ts(s.end)}
    ),
    runs as (
      select e.run_id, sum(e.cost_usd) as cost, max(e.ts) as last_ts,
        ${single(sql`coalesce(e.client_id::text, ${NONE_KEY})`)} as client_key
      from usage_events e
      where e.org_id = ${s.orgId} and e.run_id is not null and e.run_id in (select run_id from cand)
      group by e.run_id
    )
    select count(*) as runs, coalesce(sum(cost), 0) as cost
    from runs
    where last_ts >= ${ts(s.start)} and last_ts < ${ts(s.end)}
      and not exists (select 1 from outcomes x where x.org_id = ${s.orgId} and x.run_id = runs.run_id)
      ${s.clientId ? sql`and client_key = ${s.clientId}` : sql``}`,
  );
  return { runs: num(r?.runs), costUsd: num(r?.cost) };
}

/** Whether the org has ever sent a run id or an outcome (for the empty state). */
export async function hasResultData(db: Db, orgId: string): Promise<boolean> {
  const [r] = await rows(
    db,
    sql`select exists (select 1 from outcomes where org_id = ${orgId})
      or exists (select 1 from usage_events where org_id = ${orgId} and run_id is not null) as any`,
  );
  return r?.any === true;
}
