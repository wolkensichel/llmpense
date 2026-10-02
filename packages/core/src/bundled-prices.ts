import snapshot from "../data/prices.json" with { type: "json" };
import type { PriceRow } from "./pricing.ts";
import type { MergedRow } from "./prices-sync/types.ts";

/** Bundled row with its provenance (which sources listed it, where they disagreed). */
export type BundledPriceRow = PriceRow & Pick<MergedRow, "sources" | "conflicts">;

/**
 * Prices shipped with the release (see `pnpm prices:sync`).
 * They are the baseline for all time (effective from epoch); dated rows in the DB price
 * table override them, which is how price changes and negotiated discounts are recorded.
 */
export function loadBundledPrices(): BundledPriceRow[] {
  const effectiveFrom = new Date(0);
  return (snapshot.prices as unknown as MergedRow[]).map((p) => ({ ...p, effectiveFrom }));
}
