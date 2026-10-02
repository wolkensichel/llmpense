import { describe, expect, it } from "vitest";
import { currentPrices, matches, parseGenaiPrices } from "./sources/genai-prices.ts";
import { parseLiteLLM } from "./sources/litellm.ts";
import { parseModelsDev } from "./sources/models-dev.ts";
import { parsePortkey } from "./sources/portkey.ts";

const NOW = new Date("2026-10-01T00:00:00Z");

describe("litellm adapter", () => {
  const raw = {
    sample_spec: { mode: "chat" },
    "claude-opus-5-5": {
      litellm_provider: "anthropic",
      mode: "chat",
      input_cost_per_token: 4e-6,
      output_cost_per_token: 2e-5,
      cache_read_input_token_cost: 2e-7,
      cache_creation_input_token_cost: 5e-6,
    },
    "gpt-5": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5, cache_read_input_token_cost: 1.25e-7 },
    "gemini/gemini-2.5-pro": { litellm_provider: "gemini", mode: "chat", input_cost_per_token: 1.25e-6, output_cost_per_token: 1e-5 },
    "gemini-2.5-pro": { litellm_provider: "vertex_ai-language-models", mode: "chat", input_cost_per_token: 9, output_cost_per_token: 9 },
    "text-embedding-3-small": { litellm_provider: "openai", mode: "embedding", input_cost_per_token: 2e-8, output_cost_per_token: 0 },
    "gpt-x": { litellm_provider: "openai", mode: "chat", input_cost_per_token: 1e-6, output_cost_per_token: 2e-6, cache_read_input_token_cost: 0 },
  };

  it("converts per-token USD to per-million, keeps chat models of the 3 providers, strips gemini/", () => {
    const { rows } = parseLiteLLM(raw);
    expect(rows).toEqual([
      { provider: "anthropic", model: "claude-opus-5-5", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
      { provider: "openai", model: "gpt-5", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: null },
      { provider: "gemini", model: "gemini-2.5-pro", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: null, cacheWritePerMTok: null },
      { provider: "openai", model: "gpt-x", inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: null, cacheWritePerMTok: null },
    ]);
  });

  it("rejects malformed input", () => {
    expect(() => parseLiteLLM([])).toThrow();
  });
});

describe("genai-prices adapter", () => {
  const raw = [
    {
      id: "anthropic",
      models: [
        {
          id: "claude-sonnet-4-5",
          match: { or: [{ starts_with: "claude-sonnet-4-5" }, { starts_with: "claude-sonnet-4.5" }] },
          prices: {
            input_mtok: { base: 3, tiers: [{ start: 200000, price: 6 }] },
            output_mtok: { base: 15, tiers: [{ start: 200000, price: 22.5 }] },
            cache_read_mtok: 0.3,
            cache_write_mtok: 3.75,
          },
        },
      ],
    },
    {
      id: "openai",
      models: [
        {
          id: "o3",
          match: { or: [{ equals: "o3" }, { equals: "o3-2025-04-16" }, { equals: "openai-o3" }] },
          prices: [
            { prices: { input_mtok: 10, output_mtok: 40, cache_read_mtok: 0.5 } },
            { constraint: { start_date: "2025-06-10" }, prices: { input_mtok: 2, output_mtok: 8, cache_read_mtok: 0.5 } },
            { constraint: { start_date: "2027-01-01" }, prices: { input_mtok: 99, output_mtok: 99 } },
          ],
        },
        { id: "gpt-oss-120b", match: { equals: "gpt-oss-120b" }, prices: { input_mtok: 0.1, output_mtok: 0.5 } },
        { id: "text-embedding-3-small", match: { equals: "text-embedding-3-small" }, prices: { input_mtok: 0.02, output_mtok: 0 } },
      ],
    },
    {
      id: "google",
      models: [
        { id: "gemini-2.5-flash", match: { starts_with: "gemini-2.5-flash" }, prices: { input_mtok: 0.3, output_mtok: 2.5, cache_read_mtok: 0.03 } },
        { id: "claude-opus-4-1", match: { starts_with: "claude-opus-4-1" }, prices: { input_mtok: 15, output_mtok: 75 } },
      ],
    },
    { id: "groq", models: [{ id: "llama", match: { equals: "llama" }, prices: { input_mtok: 1, output_mtok: 1 } }] },
  ];

  it("maps providers, takes tier base rates and the price in effect today, emits dated aliases", () => {
    const { rows } = parseGenaiPrices(raw, NOW);
    expect(rows.map((r) => `${r.provider}/${r.model}`)).toEqual([
      "anthropic/claude-sonnet-4-5",
      "openai/o3",
      "openai/o3-2025-04-16",
      "gemini/gemini-2.5-flash",
    ]);
    expect(rows[0]).toMatchObject({ inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 });
    expect(rows[1]).toMatchObject({ inputPerMTok: 2, outputPerMTok: 8, cacheReadPerMTok: 0.5, cacheWritePerMTok: null });
  });

  it("resolves other ids through the match rules", () => {
    const { resolve } = parseGenaiPrices(raw, NOW);
    expect(resolve!("anthropic", "claude-sonnet-4-5-20250929")).toMatchObject({ model: "claude-sonnet-4-5-20250929", inputPerMTok: 3 });
    expect(resolve!("openai", "openai-o3")?.inputPerMTok).toBe(2);
    expect(resolve!("openai", "nope")).toBeUndefined();
  });

  it("evaluates match clauses", () => {
    expect(matches({ and: [{ starts_with: "gemini-2.5-pro" }, { regex: "^(?!.*-tts)" }] }, "gemini-2.5-pro-preview")).toBe(true);
    expect(matches({ and: [{ starts_with: "gemini-2.5-pro" }, { regex: "^(?!.*-tts)" }] }, "gemini-2.5-pro-tts")).toBe(false);
    expect(matches({ contains: "haiku" }, "claude-3-5-haiku")).toBe(true);
    expect(matches({ ends_with: "-latest" }, "x-latest")).toBe(true);
    expect(matches({ regex: "(" }, "x")).toBe(false);
  });

  it("ignores non-date constraints and future prices", () => {
    const p = currentPrices(
      [
        { prices: { input_mtok: 1 } },
        { constraint: { start_time: "16:30" }, prices: { input_mtok: 0.5 } },
        { constraint: { start_date: "2030-01-01" }, prices: { input_mtok: 5 } },
      ],
      NOW,
    );
    expect(p).toEqual({ input_mtok: 1 });
  });
});

describe("models.dev adapter", () => {
  const raw = {
    anthropic: {
      models: {
        "claude-opus-5-5": {
          id: "claude-opus-5-5",
          modalities: { input: ["text", "image"], output: ["text"] },
          cost: { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
        },
      },
    },
    google: {
      models: {
        "gemini-2.5-pro": { id: "gemini-2.5-pro", modalities: { output: ["text"] }, cost: { input: 1.25, output: 10, cache_read: 0.125, context_over_200k: { input: 2.5 } } },
        "gemini-2.5-flash-image": { id: "gemini-2.5-flash-image", modalities: { output: ["text", "image"] }, cost: { input: 0.3, output: 30 } },
        "gemma-4-31b-it": { id: "gemma-4-31b-it", cost: { input: 0, output: 0 } },
      },
    },
    openai: { models: { "gpt-5": { id: "gpt-5", cost: { input: 1.25, output: 10, cache_read: 0.125 } }, "o-free": { id: "o-free" } } },
    mistral: { models: { m: { id: "m", cost: { input: 1, output: 1 } } } },
  };

  it("keeps text-output models of the three providers with their costs", () => {
    const { rows } = parseModelsDev(raw);
    expect(rows).toEqual([
      { provider: "openai", model: "gpt-5", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: null },
      { provider: "anthropic", model: "claude-opus-5-5", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
      { provider: "gemini", model: "gemini-2.5-pro", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: null },
    ]);
  });
});

describe("portkey adapter", () => {
  const payg = (input: number, output: number, read = 0, write = 0) => ({
    pricing_config: {
      pay_as_you_go: {
        request_token: { price: input },
        response_token: { price: output },
        cache_read_input_token: { price: read },
        cache_write_input_token: { price: write },
      },
      currency: "USD",
    },
  });
  const raw = {
    anthropic: { default: payg(0, 0), "claude-opus-5-5": payg(0.0004, 0.002, 0.00002, 0.0005) },
    openai: { "gpt-5": payg(0.000125, 0.001, 0.0000125), "dall-e-3": payg(1, 1), "ft:gpt-4o": payg(1, 1) },
    google: {
      "gemini-2.5-pro-lte-128k": payg(0.000125, 0.001, 0.0000125),
      "gemini-2.5-pro-gt-128k": payg(0.00025, 0.0015),
      "veo-3.0-generate-001-lte-128k": payg(1, 1),
    },
  };

  it("converts cents per token to USD per million and folds -lte-Nk entries", () => {
    const { rows } = parsePortkey(raw);
    expect(rows).toEqual([
      { provider: "openai", model: "gpt-5", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: null },
      { provider: "anthropic", model: "claude-opus-5-5", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
      { provider: "gemini", model: "gemini-2.5-pro", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: null },
    ]);
  });
});
