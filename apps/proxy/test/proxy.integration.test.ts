/**
 * End-to-end: client -> proxy (real HTTP server) -> fake upstream (real HTTP server),
 * with key lookup and event recording against the real Postgres from DATABASE_URL.
 * Uses its own org (slug `proxy-test`) and deletes it afterwards.
 */
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiKeys, createDb, generateApiKey, modelPrices, orgs, recordEvents, usageEvents, clients, type Db } from "@llmpense/db";
import { createApp } from "../src/app.ts";
import { EventBatcher } from "../src/batcher.ts";
import { DbKeyResolver } from "../src/keys.ts";

const ORG_SLUG = "proxy-test";
const hasDb = !!process.env.DATABASE_URL;

interface Seen {
  path: string;
  headers: Record<string, string>;
  body: string;
}

// ---------------------------------------------------------------------------
// fake upstream

const seen: Seen[] = [];
let release: () => void = () => {};
let released: Promise<void> = Promise.resolve();
const resetGate = () => {
  released = new Promise<void>((r) => (release = r));
};

const sseLines = (objs: unknown[]) => objs.map((o) => `data: ${typeof o === "string" ? o : JSON.stringify(o)}\n\n`).join("");

const CHAT_HEAD = sseLines([
  { id: "chatcmpl-int1", object: "chat.completion.chunk", model: "llmpense-test-gpt", choices: [{ index: 0, delta: { role: "assistant", content: "" } }] },
  { id: "chatcmpl-int1", object: "chat.completion.chunk", model: "llmpense-test-gpt", choices: [{ index: 0, delta: { content: "Hello ✓" } }] },
]);
const CHAT_TAIL_USAGE = sseLines([
  { id: "chatcmpl-int1", object: "chat.completion.chunk", model: "llmpense-test-gpt", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  {
    id: "chatcmpl-int1",
    object: "chat.completion.chunk",
    model: "llmpense-test-gpt",
    choices: [],
    usage: { prompt_tokens: 120_000, completion_tokens: 50_000, total_tokens: 170_000, prompt_tokens_details: { cached_tokens: 20_000 } },
  },
  "[DONE]",
]);

const ANTHROPIC_STREAM = [
  ["message_start", { type: "message_start", message: { id: "msg_int1", model: "llmpense-test-claude", usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 2000 } } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3000 } }],
  ["message_stop", { type: "message_stop" }],
]
  .map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)
  .join("");

const enc = new TextEncoder();
/** Emits `text` in awkward slices (splitting events and UTF-8 sequences). */
function sliced(text: string, size: number): Uint8Array[] {
  const bytes = enc.encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

function fakeUpstream() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v, k) => (headers[k] = v));
    seen.push({ path: new URL(c.req.url).pathname + new URL(c.req.url).search, headers, body: await c.req.raw.clone().text() });
    await next();
  });
  app.post("/v1/chat/completions", async (c) => {
    const body = (await c.req.json()) as { model: string; stream?: boolean; stream_options?: { include_usage?: boolean } };
    if (body.model === "rate-limited") {
      return c.json({ error: { message: "Rate limit", type: "requests" } }, 429);
    }
    if (!body.stream) {
      return c.json(
        {
          id: "chatcmpl-int2",
          object: "chat.completion",
          model: body.model,
          choices: [{ index: 0, message: { role: "assistant", content: "ok" } }],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        },
        200,
        { "x-request-id": "req_hdr_2" },
      );
    }
    const tail = body.stream_options?.include_usage ? CHAT_TAIL_USAGE : sseLines(["[DONE]"]);
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        for (const ch of sliced(CHAT_HEAD, 37)) ctrl.enqueue(ch);
        // Hold the rest until the client has seen the head: proves nothing buffers.
        await released;
        for (const ch of sliced(tail, 23)) {
          ctrl.enqueue(ch);
          await new Promise((r) => setTimeout(r, 1));
        }
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "x-request-id": "req_hdr_1" } });
  });
  app.post("/v1/messages", (c) => {
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const ch of sliced(ANTHROPIC_STREAM, 50)) ctrl.enqueue(ch);
        ctrl.close();
      },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "request-id": "req_anthropic" } });
  });
  app.get("/v1/models", (c) => {
    const gz = gzipSync(JSON.stringify({ data: [{ id: "gpt-5" }] }));
    return new Response(gz, { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": String(gz.length) } });
  });
  app.post("/v1/echo", async (c) => c.text(await c.req.text()));
  return app;
}

// ---------------------------------------------------------------------------

async function listen(fetchFn: (req: Request) => Response | Promise<Response>): Promise<{ server: ServerType; url: string }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: fetchFn, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) =>
      resolve({ server, url: `http://127.0.0.1:${info.port}` }),
    );
  });
}

const close = (s: ServerType) => new Promise<void>((r) => s.close(() => r()));

describe.skipIf(!hasDb)("proxy integration", () => {
  let db: Db;
  let upstream: { server: ServerType; url: string };
  let proxy: { server: ServerType; url: string };
  let batcher: EventBatcher;
  let orgId: string;
  let keyId: string;
  let key: string;

  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Proxy test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
    const k = generateApiKey();
    key = k.key;
    const [row] = await db.insert(apiKeys).values({ orgId, name: "proxy test", prefix: k.prefix, hash: k.hash }).returning();
    keyId = row!.id;
    const effectiveFrom = new Date(0);
    await db.insert(modelPrices).values([
      { orgId, provider: "openai", model: "llmpense-test-gpt", inputPerMTok: "1", outputPerMTok: "2", cacheReadPerMTok: "0.5", effectiveFrom },
      {
        orgId,
        provider: "anthropic",
        model: "llmpense-test-claude",
        inputPerMTok: "3",
        outputPerMTok: "15",
        cacheReadPerMTok: "0.3",
        cacheWritePerMTok: "3.75",
        effectiveFrom,
      },
    ]);

    upstream = await listen(fakeUpstream().fetch);
    batcher = new EventBatcher((ctx, events) => recordEvents(db, ctx, events), { intervalMs: 50 });
    const app = createApp({
      config: { port: 0, upstreams: { openai: upstream.url, anthropic: upstream.url, gemini: upstream.url } },
      keys: new DbKeyResolver(db),
      recorder: batcher,
    });
    proxy = await listen(app.fetch);
  });

  afterAll(async () => {
    if (proxy) await close(proxy.server);
    if (upstream) await close(upstream.server);
    if (db) {
      await batcher?.flush();
      await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
      await db.$client.end();
    }
  });

  async function eventsFor(requestId: string) {
    for (let i = 0; i < 40; i++) {
      await batcher.flush();
      const rows = await db
        .select()
        .from(usageEvents)
        .where(and(eq(usageEvents.orgId, orgId), eq(usageEvents.requestId, requestId)));
      if (rows.length > 0) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return [];
  }

  it("serves /healthz", async () => {
    const res = await fetch(`${proxy.url}/healthz`);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects missing or invalid keys without calling upstream, in the provider's error shape", async () => {
    const before = seen.length;
    const r1 = await fetch(`${proxy.url}/openai/v1/chat/completions`, { method: "POST", body: "{}" });
    expect(r1.status).toBe(401);
    expect(((await r1.json()) as { error: { message: string } }).error.message).toMatch(/x-llmpense-key/);
    const r2 = await fetch(`${proxy.url}/anthropic/v1/messages`, { method: "POST", body: "{}", headers: { "x-llmpense-key": "lpk_nope" } });
    expect(r2.status).toBe(401);
    expect(await r2.json()).toMatchObject({ type: "error", error: { type: "authentication_error" } });
    expect(seen.length).toBe(before);
  });

  it("streams chat completions unmodified, injects include_usage and records the event", async () => {
    resetGate();
    const requestBody = { model: "llmpense-test-gpt", stream: true, messages: [{ role: "user", content: "hi" }] };
    const res = await fetch(`${proxy.url}/openai/v1/chat/completions?x=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer sk-upstream-secret",
        "x-custom": "kept",
        "x-llmpense-key": key,
        "x-llmpense-client": "Acme Test",
        "x-llmpense-project": "chatbot",
        "x-llmpense-feature": "chat",
        "x-llmpense-end-user": "user-42",
        "x-llmpense-metadata": JSON.stringify({ run: "abc" }),
      },
      body: JSON.stringify(requestBody),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    const headLen = enc.encode(CHAT_HEAD).length;
    // The upstream withholds the tail until we release it, so the head must arrive on its own.
    while (received < headLen) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream ended early");
      chunks.push(value);
      received += value.length;
    }
    release();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    expect(text).toBe(CHAT_HEAD + CHAT_TAIL_USAGE);

    const up = seen.at(-1)!;
    expect(up.path).toBe("/v1/chat/completions?x=1");
    expect(up.headers.authorization).toBe("Bearer sk-upstream-secret");
    expect(up.headers["x-custom"]).toBe("kept");
    expect(Object.keys(up.headers).filter((h) => h.startsWith("x-llmpense-"))).toEqual([]);
    expect(up.headers["accept-encoding"]).toBe("identity");
    expect(JSON.parse(up.body)).toEqual({ ...requestBody, stream_options: { include_usage: true } });

    const [ev] = await eventsFor("chatcmpl-int1");
    expect(ev).toMatchObject({
      source: "proxy",
      provider: "openai",
      model: "llmpense-test-gpt",
      apiKeyId: keyId,
      feature: "chat",
      endUser: "user-42",
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 20_000,
      cacheWriteTokens: 0,
      status: 200,
      streamed: true,
      priced: true,
      metadata: { run: "abc", usage_injected: true },
    });
    // 100k * $1 + 50k * $2 + 20k * $0.5 per MTok
    expect(Number(ev!.costUsd)).toBeCloseTo(0.21, 8);
    expect(ev!.latencyMs).toBeGreaterThanOrEqual(0);
    const client = await db.query.clients.findFirst({ where: eq(clients.id, ev!.clientId!) });
    expect(client?.slug).toBe("acme-test");

    const keyRow = await db.query.apiKeys.findFirst({ where: eq(apiKeys.id, keyId) });
    expect(keyRow?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("records non-stream chat completions with the request model fallback and response id", async () => {
    const res = await fetch(`${proxy.url}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmpense-key": key },
      body: JSON.stringify({ model: "llmpense-test-gpt", messages: [] }),
    });
    expect(((await res.json()) as { id: string }).id).toBe("chatcmpl-int2");
    const [ev] = await eventsFor("chatcmpl-int2");
    expect(ev).toMatchObject({ inputTokens: 1000, outputTokens: 500, streamed: false, clientId: null, metadata: null });
    expect(Number(ev!.costUsd)).toBeCloseTo(0.002, 8);
  });

  it("records Anthropic streams with cache read/write, passing x-api-key through", async () => {
    const res = await fetch(`${proxy.url}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "sk-ant-secret", "anthropic-version": "2023-06-01", "x-llmpense-key": key },
      body: JSON.stringify({ model: "llmpense-test-claude", stream: true, max_tokens: 10, messages: [] }),
    });
    expect(await res.text()).toBe(ANTHROPIC_STREAM);
    const up = seen.at(-1)!;
    expect(up.headers["x-api-key"]).toBe("sk-ant-secret");
    expect(up.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(up.body).stream_options).toBeUndefined();

    const [ev] = await eventsFor("msg_int1");
    expect(ev).toMatchObject({
      provider: "anthropic",
      model: "llmpense-test-claude",
      inputTokens: 1000,
      outputTokens: 3000,
      cacheReadTokens: 10_000,
      cacheWriteTokens: 2000,
      streamed: true,
    });
    // 1000*3 + 3000*15 + 10000*0.3 + 2000*3.75 = 58500 / 1e6
    expect(Number(ev!.costUsd)).toBeCloseTo(0.0585, 8);
  });

  it("passes errors through and skips recording when there is no usage", async () => {
    const before = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    const res = await fetch(`${proxy.url}/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-llmpense-key": key },
      body: JSON.stringify({ model: "rate-limited", messages: [] }),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { message: "Rate limit" } });
    await new Promise((r) => setTimeout(r, 100));
    await batcher.flush();
    const after = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    expect(after.length).toBe(before.length);
  });

  it("proxies unmetered paths, decoding gzip and streaming request bodies", async () => {
    const res = await fetch(`${proxy.url}/openai/v1/models`, { headers: { "x-llmpense-key": key, "accept-encoding": "gzip" } });
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.json()).toEqual({ data: [{ id: "gpt-5" }] });
    expect(seen.at(-1)!.headers["accept-encoding"]).toBe("gzip");

    const payload = "x".repeat(200_000);
    const echo = await fetch(`${proxy.url}/gemini/v1/echo`, {
      method: "POST",
      headers: { "x-llmpense-key": key, "content-type": "text/plain" },
      body: payload,
    });
    expect(await echo.text()).toBe(payload);
  });
});
