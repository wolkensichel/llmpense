import { periodMargin, type BillingMode } from "@llmpense/core";
import { DAY_MS, monthStartUtc } from "./range.ts";

/**
 * The fixed-fee rule, in one place.
 *
 * A fixed-mode client pays `monthlyFee` per calendar month. For a range [start, end)
 * each calendar month it touches contributes `monthlyFee * coveredDays / daysInThatMonth`.
 * A range covering a whole month therefore earns exactly one fee; a range covering
 * 15 of 30 days of a month earns half of it. Partial days count fractionally.
 */
export function proratedFixedFee(monthlyFee: number, start: Date, end: Date): number {
  if (!(monthlyFee > 0) || end <= start) return 0;
  let total = 0;
  for (let m = monthStartUtc(start); m < end; m = monthStartUtc(m, 1)) {
    const next = monthStartUtc(m, 1);
    const from = Math.max(m.getTime(), start.getTime());
    const to = Math.min(next.getTime(), end.getTime());
    if (to <= from) continue;
    total += monthlyFee * ((to - from) / (next.getTime() - m.getTime()));
  }
  return Math.round(total * 1e8) / 1e8;
}

export interface MarginInput {
  /** Provider cost in the range. */
  costUsd: number;
  /** Sum of per-event billed amounts in the range (frozen at ingest time). */
  billedUsd: number;
  billingMode: BillingMode | null;
  fixedFeeUsd: number;
  start: Date;
  end: Date;
}

export interface MarginResult {
  costUsd: number;
  billedUsd: number;
  fixedFeeUsd: number;
  revenueUsd: number;
  marginUsd: number;
  /** Margin over revenue; null when there is no revenue (absorbed, unattributed). */
  marginPct: number | null;
}

/**
 * Margin for one client (or unattributed traffic, billingMode null) over a range.
 * Revenue = billed amounts + the prorated fixed fee for fixed-mode clients.
 */
export function clientMargin(i: MarginInput): MarginResult {
  const fixedFeeUsd = i.billingMode === "fixed" ? proratedFixedFee(i.fixedFeeUsd, i.start, i.end) : 0;
  const m = periodMargin({ costUsd: i.costUsd, billedUsd: i.billedUsd, fixedFeeUsd });
  return { costUsd: i.costUsd, billedUsd: i.billedUsd, fixedFeeUsd, ...m };
}

/** Sums several results; margin % is recomputed from the totals, never averaged. */
export function sumMargins(rows: MarginResult[]): MarginResult {
  const t = rows.reduce(
    (a, r) => ({
      costUsd: a.costUsd + r.costUsd,
      billedUsd: a.billedUsd + r.billedUsd,
      fixedFeeUsd: a.fixedFeeUsd + r.fixedFeeUsd,
    }),
    { costUsd: 0, billedUsd: 0, fixedFeeUsd: 0 },
  );
  return { ...t, ...periodMargin(t) };
}

/** Fixed fee attributable to a single UTC day (for daily revenue lines). */
export function dailyFixedFee(monthlyFee: number, day: Date): number {
  return proratedFixedFee(monthlyFee, day, new Date(day.getTime() + DAY_MS));
}
