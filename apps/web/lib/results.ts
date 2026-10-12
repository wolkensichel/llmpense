import "server-only";
import { cheapestBucket } from "@llmpense/core";
import { hasResultData, pendingRuns, resultBuckets, type ResultBucket, type ResultDimension } from "@llmpense/db";
import { getDb } from "./db.ts";
import { ensureFreshRates } from "./fx.ts";
import { eachDay, type DateRange } from "./range.ts";

export type { ResultBucket };

interface Scope {
  orgId: string;
  range: DateRange;
  clientId?: string;
}

const dbScope = (s: Scope, name?: string) => ({ orgId: s.orgId, start: s.range.start, end: s.range.end, clientId: s.clientId, name });

/** One row per outcome name with its metrics, plus runs still waiting for an outcome. */
export async function resultsOverview(s: Scope) {
  await ensureFreshRates();
  const db = getDb();
  const [names, pending, any] = await Promise.all([
    resultBuckets(db, dbScope(s)),
    pendingRuns(db, dbScope(s)),
    hasResultData(db, s.orgId),
  ]);
  return { names, pending, hasData: any };
}

export interface OutcomeDetail {
  total: ResultBucket;
  byClient: ResultBucket[];
  byProject: ResultBucket[];
  byModel: ResultBucket[];
  /** Index into byModel of the cheapest model per success (enough runs first). */
  cheapestModel: number | null;
  daily: { day: string; runs: number; successes: number; costUsd: number; costPerSuccess: number | null }[];
}

/** Everything the detail page of one outcome name shows. */
export async function outcomeDetail(s: Scope, name: string): Promise<OutcomeDetail | null> {
  await ensureFreshRates();
  const db = getDb();
  const scope = dbScope(s, name);
  const [totals, byClient, byProject, byModel, byDay] = await Promise.all([
    resultBuckets(db, scope),
    resultBuckets(db, scope, "client"),
    resultBuckets(db, scope, "project"),
    resultBuckets(db, scope, "model"),
    resultBuckets(db, scope, "day"),
  ]);
  const t = totals[0];
  if (!t) return null;
  // Model comparison: real models first by cost per success; mixed and no-usage buckets last.
  const models = [...byModel].sort((a, b) => rankModel(a) - rankModel(b) || (a.costPerSuccess ?? Infinity) - (b.costPerSuccess ?? Infinity) || b.runs - a.runs);
  const realModels = models.filter((m) => rankModel(m) === 0);
  const cheapestIdx = cheapestBucket(realModels);
  const dayMap = new Map(byDay.map((d) => [d.key, d]));
  const daily = eachDay(s.range.start, s.range.end).map((day) => {
    const d = dayMap.get(day);
    return { day, runs: d?.runs ?? 0, successes: d?.successes ?? 0, costUsd: d?.costUsd ?? 0, costPerSuccess: d?.costPerSuccess ?? null };
  });
  return {
    total: t,
    byClient,
    byProject,
    byModel: models,
    cheapestModel: cheapestIdx === null ? null : models.indexOf(realModels[cheapestIdx]!),
    daily,
  };
}

const rankModel = (b: ResultBucket) => (b.key === null ? 2 : b.key === "*" ? 1 : 0);

/** Runs that already cost money but have no outcome yet. */
export async function pendingResults(s: Scope) {
  return pendingRuns(getDb(), dbScope(s));
}

export type { ResultDimension };
