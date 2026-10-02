import type { Provider, TokenUsage } from "./events.ts";

/** USD per million tokens. Null rates fall back to the input rate (cache) or zero. */
export interface PriceRow {
  provider: Provider;
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  effectiveFrom: Date;
}

const DATE_SUFFIX = /-(\d{4}-\d{2}-\d{2}|\d{8})$/;

/** `gpt-5.1-2025-11-13` -> `gpt-5.1`, `claude-x-20250514` -> `claude-x`. */
export function baseModelName(model: string): string {
  return model.trim().toLowerCase().replace(DATE_SUFFIX, "");
}

/**
 * Picks the price in effect at `at` for provider+model. Exact model match wins,
 * then the model with any date suffix stripped. Among matches, the latest
 * `effectiveFrom` that is <= `at` wins.
 */
export function findPrice(prices: PriceRow[], provider: Provider, model: string, at: Date): PriceRow | undefined {
  const exact = model.trim().toLowerCase();
  const base = baseModelName(model);
  for (const candidate of exact === base ? [exact] : [exact, base]) {
    let best: PriceRow | undefined;
    for (const p of prices) {
      if (p.provider !== provider || p.model.toLowerCase() !== candidate) continue;
      if (p.effectiveFrom > at) continue;
      if (!best || p.effectiveFrom > best.effectiveFrom) best = p;
    }
    if (best) return best;
  }
  return undefined;
}

export function roundUsd(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export function computeCost(usage: TokenUsage, price: PriceRow): number {
  const cacheRead = price.cacheReadPerMTok ?? price.inputPerMTok;
  const cacheWrite = price.cacheWritePerMTok ?? price.inputPerMTok;
  return roundUsd(
    (usage.inputTokens * price.inputPerMTok +
      usage.outputTokens * price.outputPerMTok +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * cacheWrite) /
      1_000_000,
  );
}
