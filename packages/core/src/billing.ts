import { roundUsd } from "./pricing.ts";

/**
 * How an agency charges a client for AI usage.
 * - markup:      provider cost * (1 + markupPct/100)
 * - passthrough: provider cost, no markup
 * - fixed:       flat monthly fee covers AI; per-event billed amount is 0, margin is computed per period
 * - absorbed:    agency eats the cost; billed 0
 */
export const BILLING_MODES = ["markup", "passthrough", "fixed", "absorbed"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];

export interface ClientBilling {
  billingMode: BillingMode;
  markupPct: number;
}

export function billedAmount(costUsd: number, billing: ClientBilling | null | undefined): number {
  if (!billing) return 0;
  switch (billing.billingMode) {
    case "markup":
      return roundUsd(costUsd * (1 + billing.markupPct / 100));
    case "passthrough":
      return costUsd;
    case "fixed":
    case "absorbed":
      return 0;
  }
}

/** Margin for a period: what the client pays minus what the agency paid providers. */
export function periodMargin(opts: { costUsd: number; billedUsd: number; fixedFeeUsd?: number }) {
  const revenue = opts.billedUsd + (opts.fixedFeeUsd ?? 0);
  const margin = revenue - opts.costUsd;
  return {
    revenueUsd: roundUsd(revenue),
    marginUsd: roundUsd(margin),
    marginPct: revenue > 0 ? margin / revenue : null,
  };
}

const utcMonthStart = (d: Date, offsetMonths = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));

/**
 * The fixed-fee rule, in one place.
 *
 * A fixed-mode client pays `monthlyFee` per calendar month (UTC). For a range [start, end)
 * each calendar month it touches contributes `monthlyFee * coveredTime / lengthOfThatMonth`.
 * A range covering a whole month therefore earns exactly one fee; a range covering
 * 15 of 30 days of a month earns half of it. Partial days count fractionally.
 */
export function proratedFixedFee(monthlyFee: number, start: Date, end: Date): number {
  return proratedFixedFeeUsd(monthlyFee, start, end, () => 1);
}

/**
 * The same rule for a fee set in another currency: each month's share is converted to USD with
 * that month's rate. `usdPerUnit(period)` returns how many USD one unit of the fee's currency is
 * worth in the `YYYY-MM` period (1 for USD); a month without a rate contributes nothing.
 */
export function proratedFixedFeeUsd(monthlyFee: number, start: Date, end: Date, usdPerUnit: (period: string) => number | null): number {
  if (!(monthlyFee > 0) || end <= start) return 0;
  let total = 0;
  for (let m = utcMonthStart(start); m < end; m = utcMonthStart(m, 1)) {
    const next = utcMonthStart(m, 1);
    const from = Math.max(m.getTime(), start.getTime());
    const to = Math.min(next.getTime(), end.getTime());
    if (to <= from) continue;
    const factor = usdPerUnit(m.toISOString().slice(0, 7));
    if (factor === null || !(factor > 0)) continue;
    total += monthlyFee * ((to - from) / (next.getTime() - m.getTime())) * factor;
  }
  return roundUsd(total);
}
