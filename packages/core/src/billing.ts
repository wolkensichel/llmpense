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
