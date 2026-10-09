import { describe, expect, it } from "vitest";
import heliconeFixture from "./fixtures/helicone.json" with { type: "json" };
import litellmFixture from "./fixtures/litellm.json" with { type: "json" };
import openrouterFixture from "./fixtures/openrouter.json" with { type: "json" };
import { normalizeProvider, resolveAttribution, resolveModel, splitModel } from "./common.ts";
import { heliconePayloadSchema, mapHelicone, verifyHeliconeSignature } from "./helicone.ts";
import { litellmBodySchema, litellmPayloadSchema, mapLiteLLM, parseLiteLLMBody } from "./litellm.ts";
import { mapOpenRouter, openrouterBodySchema } from "./openrouter.ts";
import { createHmac } from "node:crypto";

describe("provider and model normalization", () => {
  it("maps gateway provider names to the PROVIDERS enum", () => {
    expect(normalizeProvider("azure")).toBe("azure");
    expect(normalizeProvider("azure_ai")).toBe("azure");
    expect(normalizeProvider("bedrock")).toBe("bedrock");
    expect(normalizeProvider("vertex_ai")).toBe("vertex");
    expect(normalizeProvider("gemini")).toBe("gemini");
    expect(normalizeProvider("google")).toBe("gemini");
    expect(normalizeProvider("OPENAI")).toBe("openai");
    expect(normalizeProvider("Anthropic")).toBe("anthropic");
    expect(normalizeProvider("x-ai")).toBeNull();
    expect(normalizeProvider(undefined)).toBeNull();
  });

  it("strips provider prefixes and route segments", () => {
    expect(splitModel("anthropic/claude-sonnet-4-5")).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(splitModel("vertex_ai/gemini-2.5-flash")).toEqual({ provider: "vertex", model: "gemini-2.5-flash" });
    expect(splitModel("bedrock/converse/anthropic.claude-3-5-sonnet-20240620-v1:0")).toEqual({
      provider: "bedrock",
      model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    });
    expect(splitModel("gpt-4o")).toEqual({ provider: null, model: "gpt-4o" });
  });

  it("resolves provider from hints or the model name and cleans OpenRouter slugs", () => {
    expect(resolveModel("gpt-4o-mini", null, "azure")).toEqual({ provider: "azure", model: "gpt-4o-mini" });
    expect(resolveModel("claude-haiku-4-5")).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
    expect(resolveModel("anthropic/claude-sonnet-4.5")).toEqual({ provider: "anthropic", model: "claude-sonnet-4-5" });
    expect(resolveModel("google/gemini-2.5-flash:free")).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
    expect(resolveModel("meta-llama/llama-3.3-70b-instruct")).toEqual({ provider: "other", model: "meta-llama/llama-3.3-70b-instruct" });
  });
});

describe("attribution precedence", () => {
  const base = { metadata: [], tags: [], query: {}, fallbackClient: [] };

  it("prefers metadata keys, then tags, then query, then team/end user", () => {
    expect(
      resolveAttribution({
        metadata: [{ llmpense_client: "meta" }],
        tags: ["client:tag"],
        query: { client: "query" },
        fallbackClient: ["team"],
      }).client,
    ).toBe("meta");
    expect(resolveAttribution({ ...base, tags: ["client:tag"], query: { client: "query" }, fallbackClient: ["team"] }).client).toBe("tag");
    expect(resolveAttribution({ ...base, query: { client: "query" }, fallbackClient: ["team"] }).client).toBe("query");
    expect(resolveAttribution({ ...base, fallbackClient: [null, "end-user"] }).client).toBe("end-user");
    expect(resolveAttribution(base)).toEqual({});
  });

  it("reads project and feature independently and never from the team fallback", () => {
    expect(
      resolveAttribution({
        metadata: [{}, { llmpense_feature: "summarize" }],
        tags: ["project:bot", "feature:ignored"],
        query: {},
        fallbackClient: ["team"],
      }),
    ).toEqual({ client: "team", project: "bot", feature: "summarize" });
  });
});

describe("LiteLLM", () => {
  const items = litellmBodySchema.parse(litellmFixture);
  const { events, skipped } = mapLiteLLM(Array.isArray(items) ? items : [items]);

  it("maps the documented StandardLoggingPayload and skips failures", () => {
    expect(events).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it("splits cache reads out of prompt tokens and keeps cache writes separate", () => {
    expect(events[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      requestId: "chatcmpl-litellm-0001",
      inputTokens: 86,
      outputTokens: 300,
      cacheReadTokens: 1920,
      cacheWriteTokens: 512,
      latencyMs: 1750,
      client: "acme-retail",
      project: "support-bot",
      feature: "chat",
    });
    expect(events[0]!.ts).toEqual(new Date(1791538800125));
    expect(events[0]!.costUsd).toBeUndefined();
    expect(events[0]!.metadata).toMatchObject({
      integration: "litellm",
      reportedCostUsd: 0.0041526,
      keyAlias: "prod-backend",
      teamAlias: "acme-team",
      modelGroup: "claude-sonnet",
    });
  });

  it("uses tags when metadata has no attribution and normalizes azure", () => {
    expect(events[1]).toMatchObject({
      provider: "azure",
      model: "gpt-4o-mini",
      client: "globex",
      project: "invoice-parser",
      endUser: "end-user-42",
      inputTokens: 1200,
      cacheReadTokens: 0,
    });
  });

  it("falls back to team alias, then end user, then the query", () => {
    const one = litellmPayloadSchema.parse({ id: "x", model: "gpt-4o", metadata: { user_api_key_team_alias: "team-a" }, end_user: "eu" });
    expect(mapLiteLLM([one]).events[0]!.client).toBe("team-a");
    const two = litellmPayloadSchema.parse({ id: "y", model: "gpt-4o", end_user: "eu" });
    expect(mapLiteLLM([two]).events[0]!.client).toBe("eu");
    expect(mapLiteLLM([two], { client: "from-url" }).events[0]!.client).toBe("from-url");
  });

  it("prices a LiteLLM cache hit at zero", () => {
    const hit = litellmPayloadSchema.parse({ id: "z", model: "gpt-4o", cache_hit: true, prompt_tokens: 10, completion_tokens: 5 });
    expect(mapLiteLLM([hit]).events[0]).toMatchObject({ costUsd: 0, outcome: "cache_hit", provider: "openai" });
  });

  it("parses ndjson bodies", () => {
    const body = parseLiteLLMBody('{"id":"a","model":"gpt-4o"}\n{"id":"b","model":"gpt-4o"}\n');
    expect(body).toHaveLength(2);
    expect(parseLiteLLMBody("not json")).toBeUndefined();
  });
});

describe("Helicone", () => {
  it("maps the documented webhook payload", () => {
    const { events, skipped } = mapHelicone([heliconePayloadSchema.parse(heliconeFixture)]);
    expect(skipped).toBe(0);
    expect(events[0]).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      endUser: "user-123",
      client: "user-123",
      inputTokens: 10,
      outputTokens: 15,
      latencyMs: 1200,
      metadata: { integration: "helicone", reportedCostUsd: 0.0015 },
    });
  });

  it("prefers the URL client over the user id and skips payloads without usage", () => {
    const p = heliconePayloadSchema.parse(heliconeFixture);
    expect(mapHelicone([p], { client: "acme", project: "bot" }).events[0]).toMatchObject({ client: "acme", project: "bot" });
    const bare = heliconePayloadSchema.parse({ request_id: "r", user_id: "u", request_body: "", response_body: "" });
    expect(mapHelicone([bare])).toEqual({ events: [], skipped: 1 });
  });

  it("verifies the HMAC-SHA256 signature in constant time", () => {
    const raw = JSON.stringify(heliconeFixture);
    const sig = createHmac("sha256", "s3cret").update(raw).digest("hex");
    expect(verifyHeliconeSignature("s3cret", raw, heliconeFixture, sig)).toBe(true);
    expect(verifyHeliconeSignature("s3cret", JSON.stringify(heliconeFixture, null, 2), heliconeFixture, sig)).toBe(true);
    expect(verifyHeliconeSignature("other", raw, heliconeFixture, sig)).toBe(false);
    expect(verifyHeliconeSignature("s3cret", raw, heliconeFixture, null)).toBe(false);
    expect(verifyHeliconeSignature("s3cret", raw, heliconeFixture, "zz")).toBe(false);
    expect(verifyHeliconeSignature("s3cret", raw, heliconeFixture, sig.slice(0, 10))).toBe(false);
  });
});

describe("OpenRouter", () => {
  const { events, skipped } = mapOpenRouter(openrouterBodySchema.parse(openrouterFixture));

  it("maps one event per generation span", () => {
    expect(events).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("merges trace metadata from the root span and subtracts cache writes from input", () => {
    expect(events[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      requestId: "gen-1234567890-abcdefghijklmnop",
      client: "initech",
      project: "order-bot",
      endUser: "user_12345",
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 300,
      latencyMs: 1800,
      metadata: {
        integration: "openrouter",
        reportedCostUsd: 0.0072,
        openrouterModel: "anthropic/claude-sonnet-4.5",
        upstreamProvider: "Anthropic",
        sessionId: "session_abc",
        tags: ["project:order-bot", "beta"],
      },
    });
    expect(events[0]!.ts).toEqual(new Date(1791538800100));
  });

  it("handles the documented prompt_tokens/completion_tokens example without a response id", () => {
    expect(events[1]).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "abc123:def456",
      inputTokens: 100,
      outputTokens: 50,
    });
    expect(events[1]!.client).toBeUndefined();
  });

  it("ignores the empty connection-test payload and duplicate generation ids", () => {
    expect(mapOpenRouter({})).toEqual({ events: [], skipped: 0 });
    const dup = openrouterBodySchema.parse({
      resourceSpans: [openrouterFixture.resourceSpans[0], openrouterFixture.resourceSpans[0]],
    });
    expect(mapOpenRouter(dup)).toMatchObject({ skipped: 1 });
  });
});
