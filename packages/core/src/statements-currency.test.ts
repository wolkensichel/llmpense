import { describe, expect, it } from "vitest";
import { USD_RATE, type FxRate } from "./fx.ts";
import {
  aggregateLinesByProject,
  buildStatement,
  fixedFeeLoss,
  freezeStatement,
  reopenStatement,
  resolveStatement,
  showModelNames,
  type StatementTerms,
  type UsageLine,
} from "./statements.ts";

const at = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
const AFTER_SEP = at("2026-10-05");

const usage = (o: Partial<UsageLine>): UsageLine => ({
  project: "Support bot",
  provider: "openai",
  model: "gpt-5-mini",
  requests: 10,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 1,
  billedUsd: 1.3,
  ...o,
});

const EUR: FxRate = { currency: "EUR", perUsd: 0.9213, date: "2026-09-30", source: "ecb" };
const JPY: FxRate = { currency: "JPY", perUsd: 157.37, date: "2026-09-30", source: "ecb" };
const terms = (o: Partial<StatementTerms>): StatementTerms => ({ billingMode: "markup", markupPct: 30, fixedFee: 0, currency: "USD", ...o });

describe("statements in a billing currency", () => {
  it("converts per line, rounds each line, and totals the rounded lines", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: terms({ currency: "EUR" }),
      asOf: AFTER_SEP,
      fx: EUR,
      usage: [
        usage({ billedUsd: 1.005 }), // 0.9259065 -> 0.93
        usage({ model: "gpt-5", billedUsd: 1.005 }), // 0.93
        usage({ model: "o4", billedUsd: 1.005 }), // 0.93
      ],
    });
    expect(s.lines.map((l) => l.billed)).toEqual([0.93, 0.93, 0.93]);
    // Sum of rounded lines (2.79), not the rounded sum of 3.015 USD (2.78).
    expect(s.totals.usageBilled).toBe(2.79);
    expect(s.totals.totalBilled).toBe(2.79);
    expect(s.totals.usageBilledUsd).toBe(3.03);
    expect(s.fx).toEqual(EUR);
  });

  it("rounds yen to whole units", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: terms({ currency: "JPY" }),
      asOf: AFTER_SEP,
      fx: JPY,
      usage: [usage({ billedUsd: 1.3 }), usage({ model: "gpt-5", billedUsd: 0.0123 })],
    });
    // 1.3 * 157.37 = 204.581 -> 205; 0.0123 * 157.37 = 1.9356 -> 2 (sorted by model: gpt-5 first)
    expect(s.lines.map((l) => l.billed)).toEqual([2, 205]);
    expect(s.totals.totalBilled).toBe(207);
    expect(Number.isInteger(s.totals.totalBilled)).toBe(true);
  });

  it("bills the fixed fee in the billing currency and converts it to USD for the margin", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: terms({ billingMode: "fixed", markupPct: 0, fixedFee: 150, currency: "EUR" }),
      asOf: AFTER_SEP,
      fx: EUR,
      usage: [usage({ costUsd: 40, billedUsd: 0 })],
    });
    const fee = s.lines.at(-1)!;
    expect(fee).toMatchObject({ kind: "fixed_fee", billed: 150, billedUsd: 162.81 });
    expect(s.totals).toMatchObject({ fixedFee: 150, totalBilled: 150, fixedFeeUsd: 162.81, totalBilledUsd: 162.81, marginUsd: 122.81 });
  });

  it("prorates a fee in yen to whole yen for the running month", () => {
    const s = buildStatement({
      period: "2026-10",
      terms: terms({ billingMode: "fixed", fixedFee: 10_000, currency: "JPY" }),
      asOf: at("2026-10-16T12:00:00Z"),
      fx: JPY,
      usage: [],
    });
    expect(s.feeCoverage).toBe("to_date");
    expect(s.totals.fixedFee).toBe(5000); // 15.5 of 31 days
    expect(s.totals.fixedFeeUsd).toBe(31.77);
  });

  it("keeps USD statements unchanged", () => {
    const s = buildStatement({ period: "2026-09", terms: terms({}), asOf: AFTER_SEP, usage: [usage({ billedUsd: 2.76049 })] });
    expect(s.fx).toEqual(USD_RATE);
    expect(s.lines[0]).toMatchObject({ billed: 2.76, billedUsd: 2.76 });
    expect(s.totals.totalBilled).toBe(s.totals.totalBilledUsd);
  });

  it("leaves amounts in the currency empty when there is no rate", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: terms({ billingMode: "fixed", fixedFee: 100, currency: "GBP" }),
      asOf: AFTER_SEP,
      fx: EUR, // wrong currency: ignored
      usage: [usage({})],
    });
    expect(s.fx).toBeNull();
    expect(s.lines[0]!.billed).toBeNull();
    expect(s.totals).toMatchObject({ usageBilled: null, totalBilled: null, fixedFee: 100, fixedFeeUsd: 0 });
    expect(() => freezeStatement(s, AFTER_SEP)).toThrow(/No exchange rate/);
  });

  it("checks fixed-fee losses against the fee converted to USD", () => {
    const t = terms({ billingMode: "fixed", fixedFee: 300, currency: "EUR" });
    // Half of October earned: 150 EUR = 150 / 0.9213 = 162.81 USD.
    const asOf = at("2026-10-16T12:00:00Z");
    expect(fixedFeeLoss({ terms: t, period: "2026-10", costToDateUsd: 160, asOf, fx: { ...EUR, date: "2026-10-15" } })).toBeNull();
    const loss = fixedFeeLoss({ terms: t, period: "2026-10", costToDateUsd: 170, asOf, fx: { ...EUR, date: "2026-10-15" } })!;
    expect(loss.feeToDateUsd).toBeCloseTo(162.8134, 4);
    expect(loss.overByUsd).toBeCloseTo(7.1866, 4);
    expect(fixedFeeLoss({ terms: t, period: "2026-10", costToDateUsd: 1000, asOf, fx: null })).toBeNull();
  });
});

describe("hiding model names", () => {
  const s = buildStatement({
    period: "2026-09",
    terms: terms({ billingMode: "fixed", fixedFee: 99.99, currency: "EUR" }),
    asOf: AFTER_SEP,
    fx: EUR,
    usage: [
      usage({ billedUsd: 1.005, requests: 3, costUsd: 0.5 }),
      usage({ model: "gpt-5", billedUsd: 1.005, requests: 4, inputTokens: 10, costUsd: 0.25 }),
      usage({ project: "Search", model: "gpt-5", billedUsd: 2.5, requests: 1 }),
    ],
  });

  it("follows the client's override, else the org default", () => {
    expect(showModelNames(true, null)).toBe(true);
    expect(showModelNames(false, undefined)).toBe(false);
    expect(showModelNames(true, "hide")).toBe(false);
    expect(showModelNames(false, "show")).toBe(true);
  });

  it("merges lines per project without changing totals", () => {
    const lines = aggregateLinesByProject(s.lines, "EUR");
    expect(lines.map((l) => [l.kind, l.project, l.model, l.provider])).toEqual([
      ["usage", "Search", "", ""],
      ["usage", "Support bot", "", ""],
      ["fixed_fee", "Fixed monthly fee", "", ""],
    ]);
    const bot = lines[1]!;
    expect(bot).toMatchObject({ requests: 7, inputTokens: 1010, outputTokens: 400, costUsd: 0.75, billedUsd: 2.02, billed: 1.86 });
    const sum = lines.reduce((a, l) => a + (l.billed ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(s.totals.totalBilled);
    expect(lines.reduce((a, l) => a + l.requests, 0)).toBe(s.totals.requests);
    // The input lines are untouched.
    expect(s.lines).toHaveLength(4);
    expect(s.lines[0]!.model).toBe("gpt-5");
  });
});

describe("freezing and reopening with rates", () => {
  it("freezes the rate with the converted amounts and drops both on reopen", () => {
    const live = buildStatement({ period: "2026-09", terms: terms({ currency: "EUR" }), asOf: AFTER_SEP, fx: EUR, usage: [usage({})] });
    const closed = freezeStatement(live, AFTER_SEP);
    // Later rate changes don't reach the snapshot.
    live.fx!.perUsd = 2;
    live.lines[0]!.billed = 999;
    expect(closed.snapshot!.fx).toEqual(EUR);
    expect(closed.snapshot!.lines[0]!.billed).toBe(1.2);

    const newer = { ...EUR, perUsd: 0.95, date: "2026-10-12" };
    const shown = resolveStatement(closed, () => buildStatement({ period: "2026-09", terms: terms({ currency: "EUR" }), asOf: AFTER_SEP, fx: newer, usage: [usage({})] }));
    expect(shown.data.fx).toEqual(EUR);

    const reopened = reopenStatement(closed, at("2026-10-12"));
    expect(reopened.snapshot).toBeNull();
    const live2 = resolveStatement(reopened, () =>
      buildStatement({ period: "2026-09", terms: terms({ currency: "EUR" }), asOf: AFTER_SEP, fx: newer, usage: [usage({})] }),
    );
    expect(live2.status).toBe("draft");
    expect(live2.data.fx!.perUsd).toBe(0.95);
    expect(live2.data.lines[0]!.billed).toBe(1.24);
  });
});
