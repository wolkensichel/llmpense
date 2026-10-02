import { describe, expect, it } from "vitest";
import { eachDay, parseMonth, parseRangeKey, resolveRange } from "./range.ts";

const now = new Date("2026-10-15T13:45:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("resolveRange", () => {
  it("defaults to 30d for missing or unknown keys", () => {
    expect(resolveRange(undefined, now).key).toBe("30d");
    expect(resolveRange("bogus", now).key).toBe("30d");
    expect(parseRangeKey(["7d", "90d"])).toBe("7d");
  });

  it("rolling ranges include today and compare to the preceding equal span", () => {
    const r = resolveRange("7d", now);
    expect(iso(r.start)).toBe("2026-10-09");
    expect(iso(r.end)).toBe("2026-10-16");
    expect(r.days).toBe(7);
    expect(iso(r.prevStart)).toBe("2026-10-02");
    expect(iso(r.prevEnd)).toBe("2026-10-09");

    const r90 = resolveRange("90d", now);
    expect(r90.days).toBe(90);
    expect(r90.prevEnd.getTime()).toBe(r90.start.getTime());
  });

  it("month to date compares to the same days of the previous month", () => {
    const r = resolveRange("mtd", now);
    expect(iso(r.start)).toBe("2026-10-01");
    expect(iso(r.end)).toBe("2026-10-16");
    expect(r.days).toBe(15);
    expect(iso(r.prevStart)).toBe("2026-09-01");
    expect(iso(r.prevEnd)).toBe("2026-09-16");
  });

  it("month to date clamps the comparison to a shorter previous month", () => {
    const r = resolveRange("mtd", new Date("2026-03-31T08:00:00Z"));
    expect(iso(r.prevStart)).toBe("2026-02-01");
    expect(iso(r.prevEnd)).toBe("2026-03-01");
  });

  it("last month is the previous calendar month, compared to the one before", () => {
    const r = resolveRange("lm", now);
    expect(iso(r.start)).toBe("2026-09-01");
    expect(iso(r.end)).toBe("2026-10-01");
    expect(r.days).toBe(30);
    expect(iso(r.prevStart)).toBe("2026-08-01");
    expect(iso(r.prevEnd)).toBe("2026-09-01");
    expect(r.label).toBe("September 2026");
  });

  it("last month crosses the year boundary in January", () => {
    const r = resolveRange("lm", new Date("2027-01-03T00:00:00Z"));
    expect(iso(r.start)).toBe("2026-12-01");
    expect(iso(r.prevStart)).toBe("2026-11-01");
  });
});

describe("helpers", () => {
  it("eachDay lists UTC days in a half-open range", () => {
    expect(eachDay(new Date("2026-09-29T00:00:00Z"), new Date("2026-10-02T00:00:00Z"))).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("parseMonth accepts YYYY-MM only", () => {
    const m = parseMonth("2026-12");
    expect(m && iso(m.start)).toBe("2026-12-01");
    expect(m && iso(m.end)).toBe("2027-01-01");
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("26-01")).toBeNull();
    expect(parseMonth(null)).toBeNull();
  });
});
