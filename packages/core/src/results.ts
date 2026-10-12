/**
 * Cost per result. A run groups the LLM calls that work on one task; an outcome reports how the
 * run ended (success or failure) and optionally what the result is worth. These helpers turn
 * aggregated counts and sums into the metrics shown on the Results pages.
 */
import { selectDailyRate, toUsd, type Currency, type EurRate, type RateOverride } from "./fx.ts";

/** Buckets with fewer runs than this are flagged as a low sample. */
export const LOW_SAMPLE_RUNS = 20;

/** Aggregated outcome counts and sums for one bucket (an outcome name, client, project, model or day). */
export interface OutcomeTotals {
  /** Runs that reported this outcome (one outcome per run and name). */
  runs: number;
  successes: number;
  failures: number;
  /** Total provider cost of those runs, successful and failed, in USD. */
  costUsd: number;
  /** Sum of the values of successful outcomes, converted to USD; null when none carried a value. */
  successValueUsd: number | null;
  /** Runs whose outcome arrived but that have no recorded usage (yet). */
  runsWithoutUsage?: number;
}

export interface ResultMetrics extends OutcomeTotals {
  /** successes / runs; null without runs. */
  successRate: number | null;
  /** Total cost of all runs (failed attempts included) / successes; null without successes. */
  costPerSuccess: number | null;
  /** Total cost / runs; null without runs. */
  costPerRun: number | null;
  /** Success value in USD / total cost; null when no value was reported or nothing was spent. */
  valuePerDollar: number | null;
  /** Fewer than LOW_SAMPLE_RUNS runs. */
  lowSample: boolean;
}

export function resultMetrics(t: OutcomeTotals): ResultMetrics {
  return {
    ...t,
    successRate: t.runs > 0 ? t.successes / t.runs : null,
    costPerSuccess: t.successes > 0 ? t.costUsd / t.successes : null,
    costPerRun: t.runs > 0 ? t.costUsd / t.runs : null,
    valuePerDollar: t.successValueUsd !== null && t.costUsd > 0 ? t.successValueUsd / t.costUsd : null,
    lowSample: t.runs < LOW_SAMPLE_RUNS,
  };
}

/** Adds bucket totals; ratios are recomputed from the sums by `resultMetrics`, never averaged. */
export function sumOutcomeTotals(rows: readonly OutcomeTotals[]): OutcomeTotals {
  let value: number | null = null;
  const t = { runs: 0, successes: 0, failures: 0, costUsd: 0, runsWithoutUsage: 0 };
  for (const r of rows) {
    t.runs += r.runs;
    t.successes += r.successes;
    t.failures += r.failures;
    t.costUsd += r.costUsd;
    t.runsWithoutUsage += r.runsWithoutUsage ?? 0;
    if (r.successValueUsd !== null) value = (value ?? 0) + r.successValueUsd;
  }
  return { ...t, successValueUsd: value };
}

/**
 * The bucket with the lowest cost per success. Buckets with enough runs win over low-sample
 * ones; only when every bucket is a low sample is the cheapest low-sample bucket returned.
 * Buckets without successes are never the cheapest. Returns the bucket's index, or null.
 */
export function cheapestBucket(rows: readonly ResultMetrics[]): number | null {
  const pick = (allowLow: boolean) => {
    let best: number | null = null;
    rows.forEach((r, i) => {
      if (r.costPerSuccess === null || (!allowLow && r.lowSample)) return;
      if (best === null || r.costPerSuccess < rows[best]!.costPerSuccess!) best = i;
    });
    return best;
  };
  return pick(false) ?? pick(true);
}

/** Summed success values in one currency on one UTC day, as returned by the aggregate query. */
export interface ValueSum {
  currency: Currency;
  /** YYYY-MM-DD (UTC) of the outcomes. */
  day: string;
  amount: number;
}

/**
 * Converts value sums to USD, each with the rate of its outcome day (manual rate first, then
 * the latest reference rate on or before that day). Sums without a known rate are skipped and
 * counted in `missingRates`; `usd` is null when there was nothing to convert.
 */
export function valuesToUsd(
  sums: readonly ValueSum[],
  rates: readonly EurRate[],
  overrides: readonly RateOverride[] = [],
): { usd: number | null; missingRates: number } {
  let usd: number | null = null;
  let missingRates = 0;
  for (const s of sums) {
    const rate = s.currency === "USD" ? null : selectDailyRate({ currency: s.currency, day: s.day, rates, overrides });
    if (s.currency !== "USD" && !rate) {
      missingRates++;
      continue;
    }
    usd = (usd ?? 0) + (rate ? toUsd(s.amount, rate) : s.amount);
  }
  return { usd, missingRates };
}

/** "ticket_resolved" -> "Ticket resolved" */
export function outcomeLabel(name: string): string {
  const words = name.replace(/[_.:-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}
