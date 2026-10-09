import { describe, expect, it } from "vitest";
import { proratedFixedFee } from "./billing.ts";
import {
  buildStatement,
  canClose,
  cents,
  fixedFeeLoss,
  freezeStatement,
  parsePeriod,
  periodOf,
  reopenStatement,
  resolveStatement,
  shiftPeriod,
  statementFixedFee,
  type StatementTerms,
  type UsageLine,
} from "./statements.ts";

const at = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00Z` : s);

const line = (o: Partial<UsageLine>): UsageLine => ({
  project: "Support bot",
  provider: "openai",
  model: "gpt-5-mini",
  requests: 10,
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 50,
  cacheWriteTokens: 0,
  costUsd: 1,
  billedUsd: 1.3,
  ...o,
});

const markup: StatementTerms = { billingMode: "markup", markupPct: 30, fixedFeeUsd: 0 };
const fixed: StatementTerms = { billingMode: "fixed", markupPct: 0, fixedFeeUsd: 300 };
const AFTER_SEP = at("2026-10-05");

describe("periods", () => {
  it("parses YYYY-MM into a half-open UTC month", () => {
    const p = parsePeriod("2026-02")!;
    expect(p.start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(parsePeriod("2026-13")).toBeNull();
    expect(parsePeriod("2026-1")).toBeNull();
    expect(parsePeriod(null)).toBeNull();
  });

  it("shifts across year boundaries", () => {
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
    expect(periodOf(at("2026-10-09T23:59:59Z"))).toBe("2026-10");
  });
});

describe("cents", () => {
  it("rounds half away from zero without float drift", () => {
    expect(cents(1.005)).toBe(1.01);
    expect(cents(0.125)).toBe(0.13);
    expect(cents(-0.125)).toBe(-0.13);
    expect(cents(2.344999)).toBe(2.34);
    // never a negative zero, which would print as "−$0.00"
    expect(Object.is(cents(-0.004), 0)).toBe(true);
  });
});

describe("buildStatement totals", () => {
  it("sums cent-rounded lines so the total matches the printed lines", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: markup,
      asOf: AFTER_SEP,
      usage: [line({ billedUsd: 0.004, costUsd: 0.003 }), line({ model: "gpt-5", billedUsd: 0.004, costUsd: 0.003 }), line({ project: "Search", billedUsd: 10.555, costUsd: 8.12 })],
    });
    expect(s.lines.map((l) => l.billedUsd)).toEqual([10.56, 0, 0]) // "Search" sorts before "Support bot";
    expect(s.totals.usageBilledUsd).toBe(10.56);
    expect(s.totals.totalBilledUsd).toBe(10.56);
    expect(s.totals.costUsd).toBeCloseTo(8.126, 8);
    expect(s.totals.marginUsd).toBe(2.43);
    expect(s.totals.marginPct).toBeCloseTo(2.43 / 10.56, 8);
    expect(s.totals.requests).toBe(30);
    expect(s.totals.tokens).toBe(3 * 1250);
    expect(s.feeCoverage).toBe("none");
  });

  it("pass-through: sub-cent rounding of billed lines is not reported as a loss", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: { billingMode: "passthrough", markupPct: 0, fixedFeeUsd: 0 },
      asOf: AFTER_SEP,
      usage: [line({ costUsd: 1.234, billedUsd: 1.234 }), line({ model: "gpt-5", costUsd: 2.004, billedUsd: 2.004 })],
    });
    expect(s.totals.totalBilledUsd).toBe(3.23);
    expect(s.totals.costUsd).toBe(3.238);
    expect(s.totals.marginUsd).toBe(-0.01);
    const exact = buildStatement({
      period: "2026-09",
      terms: { billingMode: "passthrough", markupPct: 0, fixedFeeUsd: 0 },
      asOf: AFTER_SEP,
      usage: [line({ costUsd: 1.234, billedUsd: 1.234 })],
    });
    expect(Object.is(exact.totals.marginUsd, 0)).toBe(true);
  });

  it("sorts usage lines by project, provider and model", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: markup,
      asOf: AFTER_SEP,
      usage: [line({ project: "B" }), line({ project: "A", model: "z" }), line({ project: "A", provider: "anthropic", model: "y" })],
    });
    expect(s.lines.map((l) => `${l.project}/${l.provider}/${l.model}`)).toEqual(["A/anthropic/y", "A/openai/z", "B/openai/gpt-5-mini"]);
  });

  it("drops empty lines and handles no usage", () => {
    const s = buildStatement({ period: "2026-09", terms: markup, asOf: AFTER_SEP, usage: [line({ requests: 0, costUsd: 0, billedUsd: 0 })] });
    expect(s.lines).toEqual([]);
    expect(s.totals).toMatchObject({ requests: 0, costUsd: 0, totalBilledUsd: 0, marginUsd: 0, marginPct: null });
  });

  it("fixed: bills the whole fee for an ended month as its own last line", () => {
    const s = buildStatement({ period: "2026-09", terms: fixed, asOf: AFTER_SEP, usage: [line({ costUsd: 120, billedUsd: 0 })] });
    expect(s.feeCoverage).toBe("full");
    expect(s.lines.at(-1)).toMatchObject({ kind: "fixed_fee", project: "Fixed monthly fee", billedUsd: 300, costUsd: 0, requests: 0 });
    expect(s.totals).toMatchObject({ usageBilledUsd: 0, fixedFeeUsd: 300, totalBilledUsd: 300, marginUsd: 180 });
  });

  it("absorbed: nothing billed, margin is the negative cost", () => {
    const s = buildStatement({
      period: "2026-09",
      terms: { billingMode: "absorbed", markupPct: 0, fixedFeeUsd: 500 },
      asOf: AFTER_SEP,
      usage: [line({ costUsd: 12.5, billedUsd: 0 })],
    });
    expect(s.lines).toHaveLength(1);
    expect(s.totals).toMatchObject({ totalBilledUsd: 0, fixedFeeUsd: 0, marginUsd: -12.5, marginPct: null });
  });

  it("does not mutate its input", () => {
    const usage = [line({ billedUsd: 1.239 })];
    buildStatement({ period: "2026-09", terms: markup, asOf: AFTER_SEP, usage });
    expect(usage[0]!.billedUsd).toBe(1.239);
  });
});

describe("fixed fee proration for partial months", () => {
  const sep = parsePeriod("2026-09")!;

  it("prorates the running month up to asOf", () => {
    // 15 of 30 September days
    expect(statementFixedFee(fixed, sep, at("2026-09-16"))).toEqual({ feeUsd: 150, coverage: "to_date" });
    // half a day
    expect(statementFixedFee(fixed, sep, at("2026-09-01T12:00:00Z"))).toEqual({ feeUsd: 5, coverage: "to_date" });
  });

  it("uses each month's own length", () => {
    const feb = parsePeriod("2026-02")!;
    expect(statementFixedFee({ ...fixed, fixedFeeUsd: 280 }, feb, at("2026-02-08")).feeUsd).toBe(70);
    expect(statementFixedFee({ ...fixed, fixedFeeUsd: 280 }, feb, at("2026-03-02")).feeUsd).toBe(280);
  });

  it("bills nothing for a month that has not started or a zero fee", () => {
    expect(statementFixedFee(fixed, sep, at("2026-08-31"))).toEqual({ feeUsd: 0, coverage: "none" });
    expect(statementFixedFee({ ...fixed, fixedFeeUsd: 0 }, sep, AFTER_SEP)).toEqual({ feeUsd: 0, coverage: "none" });
    expect(statementFixedFee({ ...markup, fixedFeeUsd: 300 }, sep, AFTER_SEP)).toEqual({ feeUsd: 0, coverage: "none" });
  });

  it("rounds the prorated fee to cents and matches the dashboard rule", () => {
    const oct = parsePeriod("2026-10")!;
    const asOf = at("2026-10-10");
    expect(statementFixedFee(fixed, oct, asOf).feeUsd).toBe(cents(proratedFixedFee(300, oct.start, asOf)));
    expect(statementFixedFee(fixed, oct, asOf).feeUsd).toBe(87.1);
  });

  it("a draft of the running month shows the fee to date", () => {
    const s = buildStatement({ period: "2026-10", terms: fixed, asOf: at("2026-10-10"), usage: [line({ costUsd: 50, billedUsd: 0 })] });
    expect(s.feeCoverage).toBe("to_date");
    expect(s.totals.fixedFeeUsd).toBe(87.1);
    expect(s.totals.marginUsd).toBeCloseTo(37.1, 8);
  });
});

describe("closing, freezing and reopening", () => {
  const usage = [line({ costUsd: 100, billedUsd: 130 })];
  const live = (u = usage, terms = markup) => buildStatement({ period: "2026-09", terms, usage: u, asOf: AFTER_SEP });

  it("only allows closing a month that has ended", () => {
    expect(canClose("2026-09", at("2026-09-30T23:59:59Z"))).toMatchObject({ ok: false });
    expect(canClose("2026-09", at("2026-10-01"))).toEqual({ ok: true });
    expect(canClose("nope", AFTER_SEP)).toMatchObject({ ok: false });
  });

  it("a closed statement keeps its snapshot when usage, prices or billing change later", () => {
    const stored = freezeStatement(live(), at("2026-10-02"));
    // late events arrive, a price is corrected, the client moves to a fixed fee
    const changed = () => live([line({ costUsd: 180, billedUsd: 260 }), line({ model: "gpt-5", costUsd: 40, billedUsd: 0 })], fixed);
    const r = resolveStatement(stored, changed);
    expect(r.status).toBe("closed");
    expect(r.closedAt).toEqual(at("2026-10-02"));
    expect(r.data.totals).toMatchObject({ costUsd: 100, totalBilledUsd: 130, fixedFeeUsd: 0 });
    expect(r.data.terms).toEqual(markup);
    expect(r.data.lines).toHaveLength(1);
  });

  it("the snapshot is a copy, not a reference", () => {
    const l = live();
    const stored = freezeStatement(l, at("2026-10-02"));
    l.lines[0]!.billedUsd = 999;
    l.totals.totalBilledUsd = 999;
    expect(stored.snapshot!.lines[0]!.billedUsd).toBe(130);
    expect(stored.snapshot!.totals.totalBilledUsd).toBe(130);
  });

  it("refuses to close twice", () => {
    const stored = freezeStatement(live(), at("2026-10-02"));
    expect(() => freezeStatement(live(), at("2026-10-03"), stored)).toThrow(/already closed/);
  });

  it("reopening returns to a live draft and keeps when it was reopened", () => {
    const stored = freezeStatement(live(), at("2026-10-02"));
    const reopened = reopenStatement(stored, at("2026-10-04"));
    expect(reopened).toEqual({ status: "draft", closedAt: null, reopenedAt: at("2026-10-04"), snapshot: null });
    const r = resolveStatement(reopened, () => live([line({ costUsd: 180, billedUsd: 234 })]));
    expect(r.status).toBe("draft");
    expect(r.reopenedAt).toEqual(at("2026-10-04"));
    expect(r.data.totals.totalBilledUsd).toBe(234);
    // closing again freezes the new numbers and remembers the reopen
    const again = freezeStatement(r.data, at("2026-10-05"), reopened);
    expect(again.reopenedAt).toEqual(at("2026-10-04"));
    expect(again.snapshot!.totals.totalBilledUsd).toBe(234);
  });

  it("only a closed statement can be reopened", () => {
    expect(() => reopenStatement({ status: "draft", closedAt: null, reopenedAt: null, snapshot: null }, AFTER_SEP)).toThrow();
  });

  it("no stored record means a live draft", () => {
    const r = resolveStatement(undefined, () => live());
    expect(r).toMatchObject({ status: "draft", closedAt: null, reopenedAt: null });
    expect(r.data.totals.totalBilledUsd).toBe(130);
  });
});

describe("fixedFeeLoss", () => {
  it("flags a fixed-fee client whose cost so far exceeds the fee earned so far", () => {
    // Oct 10 00:00 = 9 of 31 days -> 87.10 of 300 earned
    const r = fixedFeeLoss({ terms: fixed, period: "2026-10", costToDateUsd: 90, asOf: at("2026-10-10") });
    expect(r).not.toBeNull();
    expect(r!.feeToDateUsd).toBeCloseTo((300 * 9) / 31, 6);
    expect(r!.overByUsd).toBeCloseTo(90 - (300 * 9) / 31, 6);
  });

  it("does not flag when the fee to date covers the cost", () => {
    expect(fixedFeeLoss({ terms: fixed, period: "2026-10", costToDateUsd: 80, asOf: at("2026-10-10") })).toBeNull();
    // exactly equal is not a loss
    expect(fixedFeeLoss({ terms: fixed, period: "2026-09", costToDateUsd: 150, asOf: at("2026-09-16") })).toBeNull();
  });

  it("clamps asOf to the month, so a past month compares against the whole fee", () => {
    expect(fixedFeeLoss({ terms: fixed, period: "2026-09", costToDateUsd: 299, asOf: at("2026-11-20") })).toBeNull();
    expect(fixedFeeLoss({ terms: fixed, period: "2026-09", costToDateUsd: 301, asOf: at("2026-11-20") })).toMatchObject({ feeToDateUsd: 300 });
  });

  it("ignores clients not on a fixed fee and months without cost", () => {
    expect(fixedFeeLoss({ terms: markup, period: "2026-10", costToDateUsd: 1000, asOf: at("2026-10-10") })).toBeNull();
    expect(fixedFeeLoss({ terms: { ...fixed, fixedFeeUsd: 0 }, period: "2026-10", costToDateUsd: 0, asOf: at("2026-10-10") })).toBeNull();
    expect(fixedFeeLoss({ terms: { ...fixed, fixedFeeUsd: 0 }, period: "2026-10", costToDateUsd: 1, asOf: at("2026-10-10") })).toMatchObject({ feeToDateUsd: 0 });
  });
});
