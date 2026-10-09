import { parsePeriod, periodOf } from "@llmpense/core";

/** `?month=YYYY-MM`, or the fallback when missing, malformed or after the current month. */
export function resolvePeriod(v: unknown, fallback: string, now = new Date()): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && parsePeriod(s) && s <= periodOf(now) ? s : fallback;
}
