import { describe, expect, it } from "vitest";
import { outcomeInputSchema, outcomesBatchSchema } from "./events.ts";
import { selectDailyRate, type EurRate } from "./fx.ts";
import {
  cheapestBucket,
  LOW_SAMPLE_RUNS,
  outcomeLabel,
  resultMetrics,
  sumOutcomeTotals,
  valuesToUsd,
  type OutcomeTotals,
} from "./results.ts";

const totals = (t: Partial<OutcomeTotals>): OutcomeTotals => ({
  runs: 0,
  successes: 0,
  failures: 0,
  costUsd: 0,
  successValueUsd: null,
  ...t,
});

describe("resultMetrics", () => {
  it("charges failed attempts to the successes: cost per success = cost of all runs / successes", () => {
    // 10 runs at $0.10 each, 8 succeeded: the 2 failures are part of the price of a result.
    const m = resultMetrics(totals({ runs: 10, successes: 8, failures: 2, costUsd: 1 }));
    expect(m.costPerSuccess).toBeCloseTo(0.125, 10);
    expect(m.costPerRun).toBeCloseTo(0.1, 10);
    expect(m.successRate).toBeCloseTo(0.8, 10);
  });

  it("has no cost per success without successes, and no rates without runs", () => {
    const failedOnly = resultMetrics(totals({ runs: 3, failures: 3, costUsd: 0.6 }));
    expect(failedOnly.costPerSuccess).toBeNull();
    expect(failedOnly.successRate).toBe(0);
    expect(failedOnly.costPerRun).toBeCloseTo(0.2, 10);

    const empty = resultMetrics(totals({}));
    expect(empty).toMatchObject({ costPerSuccess: null, costPerRun: null, successRate: null, valuePerDollar: null });
  });

  it("computes value per dollar only when values exist and something was spent", () => {
    expect(resultMetrics(totals({ runs: 4, successes: 4, costUsd: 2, successValueUsd: 40 })).valuePerDollar).toBe(20);
    expect(resultMetrics(totals({ runs: 4, successes: 4, costUsd: 2 })).valuePerDollar).toBeNull();
    expect(resultMetrics(totals({ runs: 4, successes: 4, costUsd: 0, successValueUsd: 40 })).valuePerDollar).toBeNull();
  });

  it("flags buckets with fewer than 20 runs as a low sample", () => {
    expect(LOW_SAMPLE_RUNS).toBe(20);
    expect(resultMetrics(totals({ runs: 19, successes: 19, costUsd: 1 })).lowSample).toBe(true);
    expect(resultMetrics(totals({ runs: 20, successes: 19, costUsd: 1 })).lowSample).toBe(false);
  });

  it("sums totals without averaging ratios", () => {
    const sum = sumOutcomeTotals([
      totals({ runs: 10, successes: 5, failures: 5, costUsd: 1, successValueUsd: 10, runsWithoutUsage: 1 }),
      totals({ runs: 30, successes: 30, costUsd: 2 }),
    ]);
    expect(sum).toEqual({ runs: 40, successes: 35, failures: 5, costUsd: 3, successValueUsd: 10, runsWithoutUsage: 1 });
    expect(resultMetrics(sum).costPerSuccess).toBeCloseTo(3 / 35, 10);
    expect(sumOutcomeTotals([totals({ runs: 1 })]).successValueUsd).toBeNull();
  });
});

describe("cheapestBucket", () => {
  const m = (runs: number, successes: number, costUsd: number) => resultMetrics(totals({ runs, successes, failures: runs - successes, costUsd }));

  it("prefers buckets with enough runs over a cheaper low-sample bucket", () => {
    const rows = [m(100, 80, 20), m(50, 45, 9), m(5, 5, 0.1)];
    // 0.25, 0.20 and 0.02 per success; the last has only 5 runs.
    expect(cheapestBucket(rows)).toBe(1);
  });

  it("falls back to low-sample buckets and ignores buckets without successes", () => {
    expect(cheapestBucket([m(5, 0, 1), m(8, 4, 2), m(3, 3, 3)])).toBe(1);
    expect(cheapestBucket([m(5, 0, 1)])).toBeNull();
    expect(cheapestBucket([])).toBeNull();
  });
});

describe("valuesToUsd", () => {
  const RATES: EurRate[] = [
    { date: "2026-09-30", currency: "USD", ratePerEur: 1.2, source: "ecb" },
    { date: "2026-10-01", currency: "USD", ratePerEur: 1.25, source: "ecb" },
    { date: "2026-10-01", currency: "GBP", ratePerEur: 0.8, source: "ecb" },
  ];

  it("converts each sum with the rate of its outcome day", () => {
    // EUR on 1 Oct: 1 USD = 0.8 EUR, so €40 = $50. EUR on 30 Sep: 1 USD = 1/1.2 EUR, so €10 = $12.
    const r = valuesToUsd(
      [
        { currency: "EUR", day: "2026-10-01", amount: 40 },
        { currency: "EUR", day: "2026-09-30", amount: 10 },
        { currency: "USD", day: "2026-10-01", amount: 5 },
      ],
      RATES,
    );
    expect(r.usd).toBeCloseTo(50 + 12 + 5, 8);
    expect(r.missingRates).toBe(0);
  });

  it("uses the latest rate on or before the day (weekends) and manual rates first", () => {
    // 3 Oct has no rate: 1 Oct applies. GBP: 1 USD = 0.8 / 1.25 = 0.64 GBP.
    expect(valuesToUsd([{ currency: "GBP", day: "2026-10-03", amount: 64 }], RATES).usd).toBeCloseTo(100, 8);
    const manual = valuesToUsd([{ currency: "GBP", day: "2026-10-03", amount: 50 }], RATES, [
      { currency: "GBP", perUsd: 0.5, effectiveFrom: "2026-10-02" },
    ]);
    expect(manual.usd).toBeCloseTo(100, 8);
    expect(selectDailyRate({ currency: "GBP", day: "2026-10-01", rates: RATES })?.date).toBe("2026-10-01");
  });

  it("skips sums without a rate and reports them; null when nothing converts", () => {
    const r = valuesToUsd([{ currency: "JPY", day: "2026-10-01", amount: 1000 }], RATES);
    expect(r).toEqual({ usd: null, missingRates: 1 });
    expect(valuesToUsd([], RATES)).toEqual({ usd: null, missingRates: 0 });
  });
});

describe("outcome input", () => {
  it("validates names, status and value currency", () => {
    expect(outcomeInputSchema.safeParse({ runId: "t-1", name: "ticket_resolved", status: "success" }).success).toBe(true);
    expect(
      outcomeInputSchema.safeParse({ runId: "t-1", name: "ticket_resolved", status: "success", value: { amount: 4, currency: "EUR" } }).success,
    ).toBe(true);
    expect(outcomeInputSchema.safeParse({ runId: "t-1", name: "has space", status: "success" }).success).toBe(false);
    expect(outcomeInputSchema.safeParse({ runId: "", name: "x", status: "success" }).success).toBe(false);
    expect(outcomeInputSchema.safeParse({ runId: "t", name: "x", status: "done" }).success).toBe(false);
    expect(outcomeInputSchema.safeParse({ runId: "t", name: "x", status: "success", value: { amount: 1, currency: "SEK" } }).success).toBe(false);
    expect(outcomesBatchSchema.safeParse({ outcomes: [] }).success).toBe(false);
  });

  it("labels outcome names for display", () => {
    expect(outcomeLabel("ticket_resolved")).toBe("Ticket resolved");
    expect(outcomeLabel("document-reviewed")).toBe("Document reviewed");
  });
});
