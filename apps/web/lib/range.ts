/**
 * Global date range. All boundaries are UTC midnights and half-open: [start, end).
 * Ranges that include today end at the start of tomorrow, so today's traffic counts.
 */
export const RANGE_KEYS = ["7d", "30d", "90d", "mtd", "lm"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export const DEFAULT_RANGE: RangeKey = "30d";

export const RANGE_LABELS: Record<RangeKey, { short: string; long: string }> = {
  "7d": { short: "7d", long: "Last 7 days" },
  "30d": { short: "30d", long: "Last 30 days" },
  "90d": { short: "90d", long: "Last 90 days" },
  mtd: { short: "MTD", long: "Month to date" },
  lm: { short: "Last mo", long: "Last month" },
};

export interface DateRange {
  key: RangeKey;
  start: Date;
  end: Date;
  /** The comparison period used for KPI deltas. */
  prevStart: Date;
  prevEnd: Date;
  days: number;
  label: string;
}

export const DAY_MS = 86_400_000;

export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function monthStartUtc(d: Date, offsetMonths = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
}

export function daysInMonthUtc(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function parseRangeKey(v: unknown): RangeKey {
  const s = Array.isArray(v) ? v[0] : v;
  return (RANGE_KEYS as readonly string[]).includes(s as string) ? (s as RangeKey) : DEFAULT_RANGE;
}

/**
 * Comparison periods:
 * - rolling (7d/30d/90d): the same number of days immediately before.
 * - month to date: the same first N days of the previous month (clamped to its length).
 * - last month: the calendar month before it.
 */
export function resolveRange(input: unknown, now = new Date()): DateRange {
  const key = parseRangeKey(input);
  const tomorrow = addDays(utcDay(now), 1);
  let start: Date;
  let end: Date;
  let prevStart: Date;
  let prevEnd: Date;

  if (key === "mtd") {
    start = monthStartUtc(now);
    end = tomorrow;
    prevStart = monthStartUtc(now, -1);
    const elapsed = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    prevEnd = addDays(prevStart, Math.min(elapsed, daysInMonthUtc(prevStart)));
  } else if (key === "lm") {
    start = monthStartUtc(now, -1);
    end = monthStartUtc(now);
    prevStart = monthStartUtc(now, -2);
    prevEnd = start;
  } else {
    const n = Number.parseInt(key, 10);
    end = tomorrow;
    start = addDays(end, -n);
    prevEnd = start;
    prevStart = addDays(start, -n);
  }

  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  const label =
    key === "lm"
      ? start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      : RANGE_LABELS[key].long;
  return { key, start, end, prevStart, prevEnd, days, label };
}

/** Every UTC day in [start, end) as YYYY-MM-DD. */
export function eachDay(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let t = utcDay(start).getTime(); t < end.getTime(); t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** `YYYY-MM` -> [start, end) of that UTC month, or null if malformed. */
export function parseMonth(v: string | null | undefined): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v ?? "");
  if (!m) return null;
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return { start, end: monthStartUtc(start, 1) };
}
