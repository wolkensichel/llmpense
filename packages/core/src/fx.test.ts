import { describe, expect, it } from "vitest";
import { proratedFixedFee, proratedFixedFeeUsd } from "./billing.ts";
import {
  crossRate,
  formatMoney,
  formatRate,
  fromUsd,
  isCurrency,
  minorUnits,
  periodLastDay,
  rateCutoff,
  rateNote,
  roundMinor,
  selectRate,
  sourceKind,
  toUsd,
  USD_RATE,
  type EurRate,
  type FxRate,
} from "./fx.ts";

const ecb = (date: string, rates: Record<string, number>, source = "ecb"): EurRate[] =>
  Object.entries(rates).map(([currency, ratePerEur]) => ({ date, currency, ratePerEur, source }));

// Wed 30 Sep, Thu 1 Oct, Fri 2 Oct, Mon 5 Oct 2026 (3-4 Oct is a weekend).
const RATES: EurRate[] = [
  ...ecb("2026-09-29", { USD: 1.14, GBP: 0.85, JPY: 178, CNY: 7.6, CHF: 0.95 }),
  ...ecb("2026-09-30", { USD: 1.1355, GBP: 0.85463, JPY: 178.27, CNY: 7.613, CHF: 0.9478 }),
  ...ecb("2026-10-01", { USD: 1.1298, GBP: 0.85373, JPY: 178.49, CNY: 7.5748, CHF: 0.9437 }),
  ...ecb("2026-10-02", { USD: 1.1225, GBP: 0.85033, JPY: 176.99, CNY: 7.5259, CHF: 0.9279 }),
  ...ecb("2026-10-05", { USD: 1.1204, GBP: 0.8472, JPY: 177.28, CNY: 7.5118, CHF: 0.9311 }),
];

describe("currencies", () => {
  it("knows the supported currencies and their minor units", () => {
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("SEK")).toBe(false);
    expect(isCurrency(undefined)).toBe(false);
    expect(minorUnits("JPY")).toBe(0);
    expect(minorUnits("EUR")).toBe(2);
    expect(minorUnits("CHF")).toBe(2);
  });

  it("rounds to the minor unit, half away from zero", () => {
    expect(roundMinor(1.005, "EUR")).toBe(1.01);
    expect(roundMinor(-1.005, "EUR")).toBe(-1.01);
    expect(roundMinor(1234.5, "JPY")).toBe(1235);
    expect(roundMinor(1234.49, "JPY")).toBe(1234);
    expect(roundMinor(-0.4, "JPY")).toBe(0);
  });

  it("formats money with Intl and the currency code", () => {
    expect(formatMoney(1234.5, "EUR")).toBe("€1,234.50");
    expect(formatMoney(1234.5, "USD")).toBe("$1,234.50");
    expect(formatMoney(1235, "JPY")).toBe("¥1,235");
    expect(formatMoney(12, "CHF")).toMatch(/^CHF\s12\.00$/);
    expect(formatMoney(-3.2, "GBP")).toBe("−£3.20");
  });
});

describe("conversion and cross rates", () => {
  it("derives USD cross rates via EUR", () => {
    // 1 EUR = 1.1355 USD = 0.85463 GBP  ->  1 USD = 0.85463 / 1.1355 GBP
    expect(crossRate(1.1355, 0.85463)).toBeCloseTo(0.752646, 6);
    // EUR itself: 1 USD = 1 / 1.1355 EUR
    expect(crossRate(1.1355, 1)).toBeCloseTo(0.880669, 6);
    expect(() => crossRate(0, 1)).toThrow();
  });

  it("converts USD to the currency rounded to its minor unit, and back at full precision", () => {
    const eur: FxRate = { currency: "EUR", perUsd: 0.9213, date: "2026-09-30", source: "ecb" };
    const jpy: FxRate = { currency: "JPY", perUsd: 157.0, date: "2026-09-30", source: "ecb" };
    expect(fromUsd(10, eur)).toBe(9.21);
    expect(fromUsd(10.005, eur)).toBe(9.22);
    expect(fromUsd(1.23, jpy)).toBe(193);
    expect(fromUsd(10, USD_RATE)).toBe(10);
    expect(toUsd(150, eur)).toBeCloseTo(162.813416, 5);
  });

  it("converts a fixed fee in another currency with each month's rate", () => {
    const sep = new Date("2026-09-01T00:00:00Z");
    const oct = new Date("2026-10-01T00:00:00Z");
    const nov = new Date("2026-11-01T00:00:00Z");
    // Whole September at 1 EUR = 1.10 USD: 150 EUR = 165 USD.
    expect(proratedFixedFeeUsd(150, sep, oct, () => 1.1)).toBe(165);
    // Half of September at 1.10 plus the first half of October (15.5 of 31 days) at 1.20.
    const mid = new Date("2026-09-16T00:00:00Z");
    const midOct = new Date("2026-10-16T12:00:00Z");
    const usdPer = (p: string) => (p === "2026-09" ? 1.1 : 1.2);
    expect(proratedFixedFeeUsd(150, mid, midOct, usdPer)).toBeCloseTo(150 * 0.5 * 1.1 + 150 * 0.5 * 1.2, 6);
    // A month without a rate contributes nothing; USD (factor 1) matches the plain rule.
    expect(proratedFixedFeeUsd(150, sep, nov, (p) => (p === "2026-09" ? 1.1 : null))).toBe(165);
    expect(proratedFixedFeeUsd(300, mid, midOct, () => 1)).toBe(proratedFixedFee(300, mid, midOct));
  });
});

describe("rate selection", () => {
  it("uses the last day of the month, or today while the month runs", () => {
    expect(periodLastDay("2026-02")).toBe("2026-02-28");
    expect(periodLastDay("2028-02")).toBe("2028-02-29");
    expect(rateCutoff("2026-09", "2026-10-12")).toBe("2026-09-30");
    expect(rateCutoff("2026-10", "2026-10-12")).toBe("2026-10-12");
  });

  it("picks the last available business day on or before the month end", () => {
    const r = selectRate({ currency: "EUR", period: "2026-09", today: "2026-10-12", rates: RATES })!;
    expect(r).toMatchObject({ currency: "EUR", date: "2026-09-30", source: "ecb" });
    expect(r.perUsd).toBeCloseTo(1 / 1.1355, 10);
    const gbp = selectRate({ currency: "GBP", period: "2026-09", today: "2026-10-12", rates: RATES })!;
    expect(gbp.perUsd).toBeCloseTo(0.85463 / 1.1355, 10);
  });

  it("falls back over weekends and missing days", () => {
    // October 2026 ends on a Saturday; with rates only up to Fri 2 Oct stored, that day applies.
    const upToFri = RATES.filter((r) => r.date <= "2026-10-02");
    expect(selectRate({ currency: "CHF", period: "2026-10", today: "2026-11-03", rates: upToFri })!.date).toBe("2026-10-02");
    // A day missing the target currency is skipped.
    const gap = RATES.filter((r) => !(r.date === "2026-09-30" && r.currency === "JPY"));
    expect(selectRate({ currency: "JPY", period: "2026-09", today: "2026-10-12", rates: gap })!.date).toBe("2026-09-29");
    // So is a day missing USD.
    const noUsd = RATES.filter((r) => !(r.date === "2026-09-30" && r.currency === "USD"));
    expect(selectRate({ currency: "EUR", period: "2026-09", today: "2026-10-12", rates: noUsd })!.date).toBe("2026-09-29");
  });

  it("uses the latest available rate for the running month", () => {
    // Sunday 4 Oct: Friday's rate.
    expect(selectRate({ currency: "EUR", period: "2026-10", today: "2026-10-04", rates: RATES })!.date).toBe("2026-10-02");
    expect(selectRate({ currency: "EUR", period: "2026-10", today: "2026-10-12", rates: RATES })!.date).toBe("2026-10-05");
  });

  it("returns null without a rate, and 1 for USD", () => {
    expect(selectRate({ currency: "EUR", period: "2026-08", today: "2026-10-12", rates: RATES })).toBeNull();
    expect(selectRate({ currency: "USD", period: "2026-08", today: "2026-10-12", rates: [] })).toBe(USD_RATE);
  });

  it("lets manual rates win over ECB rates from their effective date", () => {
    const overrides = [
      { currency: "EUR" as const, perUsd: 0.9, effectiveFrom: "2026-09-15" },
      { currency: "EUR" as const, perUsd: 0.95, effectiveFrom: "2026-10-03" },
      { currency: "GBP" as const, perUsd: 0.7, effectiveFrom: "2026-11-01" },
    ];
    expect(selectRate({ currency: "EUR", period: "2026-09", today: "2026-10-12", rates: RATES, overrides })).toEqual({
      currency: "EUR",
      perUsd: 0.9,
      date: "2026-09-15",
      source: "manual",
    });
    expect(selectRate({ currency: "EUR", period: "2026-10", today: "2026-10-12", rates: RATES, overrides })!.perUsd).toBe(0.95);
    // Not effective yet: the ECB rate applies.
    expect(selectRate({ currency: "GBP", period: "2026-10", today: "2026-10-12", rates: RATES, overrides })!.source).toBe("ecb");
    // A manual rate also covers months without any ECB data.
    expect(selectRate({ currency: "EUR", period: "2026-09", today: "2026-10-12", rates: [], overrides })!.perUsd).toBe(0.9);
  });

  it("labels demo rates from the seed", () => {
    const seed = ecb("2026-09-30", { USD: 1.16, GBP: 0.86 }, "seed (demo data, not ECB)");
    expect(sourceKind("seed (demo data, not ECB)")).toBe("seed");
    expect(selectRate({ currency: "GBP", period: "2026-09", today: "2026-10-12", rates: seed })!.source).toBe("seed");
  });
});

describe("rate note", () => {
  it("states the rate, its kind and date", () => {
    expect(rateNote({ currency: "EUR", perUsd: 0.92131, date: "2026-09-30", source: "ecb" })).toBe(
      "1 USD = 0.9213 EUR, ECB reference rate of 30 Sep 2026",
    );
    expect(rateNote({ currency: "JPY", perUsd: 157.123, date: "2026-09-30", source: "manual" })).toBe(
      "1 USD = 157.12 JPY, manual rate of 30 Sep 2026",
    );
    expect(rateNote(USD_RATE)).toBeNull();
    expect(rateNote(null)).toBeNull();
    expect(formatRate(1.5)).toBe("1.5000");
  });
});
