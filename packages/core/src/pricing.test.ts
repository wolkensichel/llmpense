import { describe, expect, it } from "vitest";
import { baseModelName, computeCost, findPrice, type PriceRow } from "./pricing.ts";
import { billedAmount, periodMargin } from "./billing.ts";

const row = (model: string, from: string, input = 2, output = 10): PriceRow => ({
  provider: "anthropic",
  model,
  inputPerMTok: input,
  outputPerMTok: output,
  cacheReadPerMTok: 0.2,
  cacheWritePerMTok: 2.5,
  effectiveFrom: new Date(from),
});

describe("findPrice", () => {
  const prices = [row("claude-sonnet-5-5", "2026-01-01"), row("claude-sonnet-5-5", "2026-06-01", 1.5, 8)];

  it("picks the latest price effective at the call time", () => {
    expect(findPrice(prices, "anthropic", "claude-sonnet-5-5", new Date("2026-03-01"))?.inputPerMTok).toBe(2);
    expect(findPrice(prices, "anthropic", "claude-sonnet-5-5", new Date("2026-07-01"))?.inputPerMTok).toBe(1.5);
  });

  it("falls back to the model name without date suffix", () => {
    expect(findPrice(prices, "anthropic", "claude-sonnet-5-5-20260101", new Date("2026-03-01"))).toBeDefined();
    expect(baseModelName("gpt-5.1-2025-11-13")).toBe("gpt-5.1");
  });

  it("returns undefined for unknown models or before the first price", () => {
    expect(findPrice(prices, "anthropic", "nope", new Date())).toBeUndefined();
    expect(findPrice(prices, "openai", "claude-sonnet-5-5", new Date())).toBeUndefined();
    expect(findPrice(prices, "anthropic", "claude-sonnet-5-5", new Date("2025-01-01"))).toBeUndefined();
  });
});

describe("computeCost", () => {
  it("prices each token bucket at its own rate", () => {
    const cost = computeCost(
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000, cacheWriteTokens: 200_000 },
      row("m", "2026-01-01"),
    );
    // 2 + 1 + 0.1 + 0.5
    expect(cost).toBeCloseTo(3.6, 8);
  });
});

describe("billing", () => {
  it("applies markup, passthrough and absorbed modes", () => {
    expect(billedAmount(10, { billingMode: "markup", markupPct: 25 })).toBe(12.5);
    expect(billedAmount(10, { billingMode: "passthrough", markupPct: 0 })).toBe(10);
    expect(billedAmount(10, { billingMode: "absorbed", markupPct: 0 })).toBe(0);
    expect(billedAmount(10, null)).toBe(0);
  });

  it("computes period margin including a fixed fee", () => {
    expect(periodMargin({ costUsd: 40, billedUsd: 0, fixedFeeUsd: 100 })).toEqual({
      revenueUsd: 100,
      marginUsd: 60,
      marginPct: 0.6,
    });
    expect(periodMargin({ costUsd: 5, billedUsd: 0 }).marginPct).toBeNull();
  });
});
