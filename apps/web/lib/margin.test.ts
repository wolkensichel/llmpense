import { describe, expect, it } from "vitest";
import { clientMargin, dailyFixedFee, proratedFixedFee, sumMargins } from "./margin.ts";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("proratedFixedFee", () => {
  it("charges exactly one fee for a full calendar month", () => {
    expect(proratedFixedFee(300, d("2026-09-01"), d("2026-10-01"))).toBe(300);
    expect(proratedFixedFee(310, d("2026-02-01"), d("2026-03-01"))).toBe(310);
  });

  it("prorates a partial month by days of that month", () => {
    // 15 of 30 September days
    expect(proratedFixedFee(300, d("2026-09-01"), d("2026-09-16"))).toBe(150);
    // 7 of 28 February days
    expect(proratedFixedFee(280, d("2026-02-10"), d("2026-02-17"))).toBe(70);
    // a single day of a 31-day month
    expect(proratedFixedFee(310, d("2026-10-01"), d("2026-10-02"))).toBe(10);
  });

  it("splits a range across months using each month's own length", () => {
    // Sep 21-30 = 10/30 of Sep, Oct 1-10 = 10/31 of Oct
    const fee = proratedFixedFee(300, d("2026-09-21"), d("2026-10-11"));
    expect(fee).toBeCloseTo(100 + (300 * 10) / 31, 6);
  });

  it("counts every whole month inside a long range once", () => {
    expect(proratedFixedFee(100, d("2026-01-01"), d("2026-04-01"))).toBe(300);
    // leap year February is a full month too
    expect(proratedFixedFee(100, d("2028-02-01"), d("2028-03-01"))).toBe(100);
  });

  it("counts partial days fractionally", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-09-01T12:00:00Z");
    expect(proratedFixedFee(300, start, end)).toBe(5);
  });

  it("is zero for empty, inverted or zero-fee ranges", () => {
    expect(proratedFixedFee(300, d("2026-09-10"), d("2026-09-10"))).toBe(0);
    expect(proratedFixedFee(300, d("2026-09-10"), d("2026-09-01"))).toBe(0);
    expect(proratedFixedFee(0, d("2026-09-01"), d("2026-10-01"))).toBe(0);
    expect(proratedFixedFee(-5, d("2026-09-01"), d("2026-10-01"))).toBe(0);
  });

  it("is additive: daily fees over a month sum to the monthly fee", () => {
    let sum = 0;
    for (let i = 1; i <= 30; i++) sum += dailyFixedFee(300, d(`2026-09-${String(i).padStart(2, "0")}`));
    expect(sum).toBeCloseTo(300, 6);
  });
});

describe("clientMargin", () => {
  const sep = { start: d("2026-09-01"), end: d("2026-10-01") };

  it("markup: revenue is the frozen billed amount", () => {
    const m = clientMargin({ costUsd: 100, billedUsd: 130, billingMode: "markup", fixedFeeUsd: 0, ...sep });
    expect(m).toMatchObject({ revenueUsd: 130, marginUsd: 30, fixedFeeUsd: 0 });
    expect(m.marginPct).toBeCloseTo(30 / 130);
  });

  it("fixed: revenue is the prorated fee, billed is ignored only when zero", () => {
    const m = clientMargin({ costUsd: 400, billedUsd: 0, billingMode: "fixed", fixedFeeUsd: 300, ...sep });
    expect(m).toMatchObject({ revenueUsd: 300, marginUsd: -100, fixedFeeUsd: 300 });
    expect(m.marginPct).toBeCloseTo(-1 / 3);

    const half = clientMargin({ costUsd: 50, billedUsd: 0, billingMode: "fixed", fixedFeeUsd: 300, start: d("2026-09-01"), end: d("2026-09-16") });
    expect(half.revenueUsd).toBe(150);
    expect(half.marginUsd).toBe(100);
  });

  it("ignores the fee for clients not on fixed billing", () => {
    const m = clientMargin({ costUsd: 10, billedUsd: 10, billingMode: "passthrough", fixedFeeUsd: 999, ...sep });
    expect(m).toMatchObject({ revenueUsd: 10, marginUsd: 0, fixedFeeUsd: 0, marginPct: 0 });
  });

  it("absorbed and unattributed: no revenue, margin % undefined", () => {
    const a = clientMargin({ costUsd: 12.5, billedUsd: 0, billingMode: "absorbed", fixedFeeUsd: 0, ...sep });
    expect(a).toMatchObject({ revenueUsd: 0, marginUsd: -12.5, marginPct: null });
    const u = clientMargin({ costUsd: 3, billedUsd: 0, billingMode: null, fixedFeeUsd: 300, ...sep });
    expect(u).toMatchObject({ fixedFeeUsd: 0, marginUsd: -3, marginPct: null });
  });
});

describe("sumMargins", () => {
  it("recomputes margin % from totals instead of averaging", () => {
    const sep = { start: d("2026-09-01"), end: d("2026-10-01") };
    const a = clientMargin({ costUsd: 100, billedUsd: 200, billingMode: "markup", fixedFeeUsd: 0, ...sep });
    const b = clientMargin({ costUsd: 50, billedUsd: 0, billingMode: "absorbed", fixedFeeUsd: 0, ...sep });
    const t = sumMargins([a, b]);
    expect(t).toMatchObject({ costUsd: 150, revenueUsd: 200, marginUsd: 50 });
    expect(t.marginPct).toBeCloseTo(0.25);
  });

  it("handles an empty list", () => {
    expect(sumMargins([])).toMatchObject({ costUsd: 0, revenueUsd: 0, marginUsd: 0, marginPct: null });
  });
});
