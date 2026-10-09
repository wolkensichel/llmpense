import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@llmpense/core";
import { apiKeys, clients, createDb, generateApiKey, modelPrices, orgs, usageEvents, type Db } from "@llmpense/db";
import type { IngestDeps, IngestKey } from "../ingest.ts";
import { dbIngestDeps } from "../ingest-db.ts";
import heliconeFixture from "./fixtures/helicone.json" with { type: "json" };
import litellmFixture from "./fixtures/litellm.json" with { type: "json" };
import openrouterFixture from "./fixtures/openrouter.json" with { type: "json" };
import { handleIntegration } from "./handler.ts";
import type { Integration } from "./common.ts";

const KEY: IngestKey = { id: "k1", orgId: "o1", defaultClientId: null, defaultProjectId: null };
const TOKEN = "lpk_abcDEF123_-xyz";

function deps() {
  return {
    hash: (t: string) => `h:${t}`,
    findKey: vi.fn(async (h: string) => (h === `h:${TOKEN}` ? KEY : null)),
    record: vi.fn(async (_k: IngestKey, events: UsageEventInput[]) => ({ inserted: events.length })),
  } satisfies IngestDeps;
}

function req(tool: Integration, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }, query = "") {
  return new Request(`http://x/api/v1/integrations/${tool}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const FIXTURES: Record<Integration, unknown> = { litellm: litellmFixture, helicone: heliconeFixture, openrouter: openrouterFixture };

describe("handleIntegration", () => {
  it.each(Object.keys(FIXTURES) as Integration[])("%s: 401 without a valid key", async (tool) => {
    const variants: Record<string, string>[] = [
      {},
      { authorization: "Bearer sk-live" },
      { authorization: "Bearer lpk_unknown" },
      { "x-llmpense-key": "nope" },
    ];
    for (const headers of variants) {
      const d = deps();
      const res = await handleIntegration(req(tool, FIXTURES[tool], headers), tool, d, { heliconeSecret: "" });
      expect(res.status).toBe(401);
      expect(d.record).not.toHaveBeenCalled();
    }
  });

  it.each(Object.keys(FIXTURES) as Integration[])("%s: 200 with the fixture", async (tool) => {
    const d = deps();
    const res = await handleIntegration(req(tool, FIXTURES[tool]), tool, d, { heliconeSecret: "" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { inserted: number };
    expect(body.inserted).toBeGreaterThan(0);
    for (const e of d.record.mock.calls[0]![1]) expect(e.metadata?.integration).toBe(tool);
  });

  it("accepts x-llmpense-key, and ?key= only for Helicone", async () => {
    let d = deps();
    expect((await handleIntegration(req("litellm", litellmFixture, { "x-llmpense-key": TOKEN }), "litellm", d)).status).toBe(200);
    d = deps();
    expect((await handleIntegration(req("helicone", heliconeFixture, {}, `?key=${TOKEN}`), "helicone", d, { heliconeSecret: "" })).status).toBe(200);
    d = deps();
    expect((await handleIntegration(req("litellm", litellmFixture, {}, `?key=${TOKEN}`), "litellm", d)).status).toBe(401);
  });

  it("returns 400 with issues for malformed payloads", async () => {
    const cases: [Integration, unknown][] = [
      ["litellm", "{not json"],
      ["litellm", [{ model: "gpt-4o" }]],
      ["litellm", []],
      ["helicone", { user_id: "u" }],
      ["helicone", { request_id: "r", metadata: { promptTokens: -1 } }],
      ["openrouter", { resourceSpans: "nope" }],
    ];
    for (const [tool, body] of cases) {
      const d = deps();
      const res = await handleIntegration(req(tool, body), tool, d, { heliconeSecret: "" });
      expect(res.status, `${tool} ${JSON.stringify(body)}`).toBe(400);
      expect(d.record).not.toHaveBeenCalled();
    }
    const res = await handleIntegration(req("helicone", { user_id: "u" }), "helicone", deps(), { heliconeSecret: "" });
    expect(((await res.json()) as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it("answers the OpenRouter connection test with 200", async () => {
    for (const body of ["", {}, { resourceSpans: [] }]) {
      const d = deps();
      const res = await handleIntegration(req("openrouter", body, { authorization: `Bearer ${TOKEN}`, "x-test-connection": "true" }), "openrouter", d);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: 0, inserted: 0, skipped: 0 });
      expect(d.record).not.toHaveBeenCalled();
    }
  });

  it("requires a valid helicone-signature when a secret is configured", async () => {
    const raw = JSON.stringify(heliconeFixture);
    const sig = createHmac("sha256", "whsec").update(raw).digest("hex");
    const auth = { authorization: `Bearer ${TOKEN}` };
    let d = deps();
    expect((await handleIntegration(req("helicone", raw, auth), "helicone", d, { heliconeSecret: "whsec" })).status).toBe(401);
    expect((await handleIntegration(req("helicone", raw, { ...auth, "helicone-signature": "00ff" }), "helicone", d, { heliconeSecret: "whsec" })).status).toBe(401);
    expect(d.record).not.toHaveBeenCalled();
    d = deps();
    expect((await handleIntegration(req("helicone", raw, { ...auth, "helicone-signature": sig }), "helicone", d, { heliconeSecret: "whsec" })).status).toBe(200);
    expect(d.record).toHaveBeenCalledOnce();
  });
});

const ORG_SLUG = "integrations-test";
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("integration endpoints against Postgres", () => {
  let db: Db;
  let orgId: string;
  let key: string;

  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Integrations test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
    const k = generateApiKey();
    key = k.key;
    await db.insert(apiKeys).values({ orgId, name: "integrations test", prefix: k.prefix, hash: k.hash });
    const effectiveFrom = new Date(0);
    await db.insert(modelPrices).values([
      { orgId, provider: "anthropic", model: "claude-sonnet-4-5", inputPerMTok: "3", outputPerMTok: "15", cacheReadPerMTok: "0.3", cacheWritePerMTok: "3.75", effectiveFrom },
      { orgId, provider: "openai", model: "gpt-4o-mini", inputPerMTok: "0.15", outputPerMTok: "0.6", cacheReadPerMTok: "0.075", effectiveFrom },
    ]);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
      await db.$client.end();
    }
  });

  const post = (tool: Integration, body: unknown) =>
    handleIntegration(req(tool, body, { authorization: `Bearer ${key}` }), tool, dbIngestDeps(db), { heliconeSecret: "" });

  async function event(requestId: string) {
    const rows = await db
      .select({ e: usageEvents, client: clients.slug })
      .from(usageEvents)
      .leftJoin(clients, eq(clients.id, usageEvents.clientId))
      .where(and(eq(usageEvents.orgId, orgId), eq(usageEvents.requestId, requestId)));
    return rows;
  }

  it("stores LiteLLM events with computed cost and dedupes retries", async () => {
    const first = await post("litellm", litellmFixture);
    expect(await first.json()).toEqual({ received: 3, inserted: 2, skipped: 1 });
    const retry = await post("litellm", litellmFixture);
    expect(await retry.json()).toEqual({ received: 3, inserted: 0, skipped: 1 });

    const rows = await event("chatcmpl-litellm-0001");
    expect(rows).toHaveLength(1);
    const { e, client } = rows[0]!;
    expect(client).toBe("acme-retail");
    expect(e).toMatchObject({ source: "ingest", provider: "anthropic", inputTokens: 86, cacheReadTokens: 1920, cacheWriteTokens: 512, priced: true });
    // 86*3 + 300*15 + 1920*0.3 + 512*3.75 per million tokens
    expect(Number(e.costUsd)).toBeCloseTo(0.007254, 8);
    expect(e.metadata).toMatchObject({ integration: "litellm", reportedCostUsd: 0.0041526 });
  });

  it("stores Helicone and OpenRouter events", async () => {
    expect(await (await post("helicone", heliconeFixture)).json()).toMatchObject({ inserted: 1 });
    const [h] = await event("550e8400-e29b-41d4-a716-446655440000");
    expect(h!.client).toBe("user-123");
    expect(Number(h!.e.costUsd)).toBeCloseTo((10 * 0.15 + 15 * 0.6) / 1e6, 10);

    expect(await (await post("openrouter", openrouterFixture)).json()).toMatchObject({ inserted: 2 });
    const [o] = await event("gen-1234567890-abcdefghijklmnop");
    expect(o!.client).toBe("initech");
    expect(o!.e).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-5", inputTokens: 1000, cacheWriteTokens: 300 });
    expect(Number(o!.e.costUsd)).toBeCloseTo((1000 * 3 + 200 * 15 + 300 * 3.75) / 1e6, 10);
    expect(await (await post("openrouter", openrouterFixture)).json()).toMatchObject({ inserted: 0 });
  });
});
