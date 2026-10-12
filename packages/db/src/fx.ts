import { and, desc, eq, inArray, lte, max, sql } from "drizzle-orm";
import {
  ECB_SOURCE,
  fetchEcbRates,
  rateCutoff,
  selectRate,
  type Currency,
  type EcbFeed,
  type EurRate,
  type FxRate,
  type RateOverride,
} from "@llmpense/core";
import type { Db } from "./client.ts";
import { fxRateOverrides, fxRates } from "./schema.ts";

/** Today's date in UTC, YYYY-MM-DD. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Inserts or updates reference rates (idempotent). Returns how many rows were written. */
export async function upsertEurRates(db: Db, rates: readonly EurRate[], opts: { overwrite?: boolean } = {}) {
  if (rates.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rates.length; i += 1000) {
    const values = rates.slice(i, i + 1000).map((r) => ({ date: r.date, currency: r.currency, ratePerEur: String(r.ratePerEur), source: r.source }));
    const q = db.insert(fxRates).values(values);
    const done =
      opts.overwrite === false
        ? await q.onConflictDoNothing().returning({ date: fxRates.date })
        : await q
            .onConflictDoUpdate({
              target: [fxRates.date, fxRates.currency],
              set: { ratePerEur: sql`excluded.rate_per_eur`, source: sql`excluded.source`, fetchedAt: sql`now()` },
            })
            .returning({ date: fxRates.date });
    written += done.length;
  }
  return written;
}

/** Date of the newest ECB rate stored (demo seed rows don't count), or null. */
export async function latestEcbRateDate(db: Db): Promise<string | null> {
  const [row] = await db.select({ d: max(fxRates.date) }).from(fxRates).where(eq(fxRates.source, ECB_SOURCE));
  return row?.d ?? null;
}

export interface SyncResult {
  feed: EcbFeed;
  /** Rows parsed from the feed (supported currencies only). */
  received: number;
  written: number;
  /** Newest date in the feed. */
  latestDate: string | null;
}

/** Downloads an ECB feed and upserts its rates. */
export async function syncEcbRates(db: Db, opts: { feed?: EcbFeed; timeoutMs?: number; fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<SyncResult> {
  const feed = opts.feed ?? "90d";
  const rates = await fetchEcbRates(feed, opts);
  const written = await upsertEurRates(db, rates);
  const latestDate = rates.reduce<string | null>((a, r) => (a === null || r.date > a ? r.date : a), null);
  return { feed, received: rates.length, written, latestDate };
}

/**
 * Reference rates relevant to the given cutoff dates: for each cutoff, the last ten dates on or
 * before it that have a USD rate (enough to skip over a day missing a currency).
 */
export async function loadEurRates(db: Db, cutoffs: readonly string[]): Promise<EurRate[]> {
  const unique = [...new Set(cutoffs)];
  if (unique.length === 0) return [];
  const dates = new Set<string>();
  for (const cutoff of unique) {
    const rows = await db
      .select({ date: fxRates.date })
      .from(fxRates)
      .where(and(eq(fxRates.currency, "USD"), lte(fxRates.date, cutoff)))
      .orderBy(desc(fxRates.date))
      .limit(10);
    for (const r of rows) dates.add(r.date);
  }
  if (dates.size === 0) return [];
  const rows = await db.select().from(fxRates).where(inArray(fxRates.date, [...dates]));
  return rows.map((r) => ({ date: r.date, currency: r.currency, ratePerEur: Number(r.ratePerEur), source: r.source }));
}

export async function listRateOverrides(db: Db, orgId: string) {
  return db
    .select()
    .from(fxRateOverrides)
    .where(eq(fxRateOverrides.orgId, orgId))
    .orderBy(fxRateOverrides.currency, desc(fxRateOverrides.effectiveFrom));
}

const toOverride = (r: typeof fxRateOverrides.$inferSelect): RateOverride => ({
  currency: r.currency,
  perUsd: Number(r.ratePerUsd),
  effectiveFrom: r.effectiveFrom,
});

/** Resolves the rate for a currency and month from stored data. */
export type FxResolver = (currency: Currency, period: string) => FxRate | null;

/**
 * Loads what is needed to pick rates for `periods` (manual rates of the org and the reference
 * rates around each month's cutoff) and returns a resolver. Never touches the network.
 */
export async function fxResolver(db: Db, orgId: string, periods: readonly string[], now = new Date()): Promise<FxResolver> {
  const today = utcDay(now);
  const [overrides, rates] = await Promise.all([
    listRateOverrides(db, orgId),
    loadEurRates(
      db,
      periods.map((p) => rateCutoff(p, today)),
    ),
  ]);
  const ov = overrides.map(toOverride);
  const memo = new Map<string, FxRate | null>();
  return (currency, period) => {
    const k = `${currency}/${period}`;
    if (!memo.has(k)) memo.set(k, selectRate({ currency, period, today, rates, overrides: ov }));
    return memo.get(k)!;
  };
}
