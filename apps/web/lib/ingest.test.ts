import { describe, expect, it, vi } from "vitest";
import type { UsageEventInput } from "@llmpense/core";
import { handleIngest, type IngestDeps, type IngestKey } from "./ingest.ts";

const KEY: IngestKey = { id: "k1", orgId: "o1", defaultClientId: "c1", defaultProjectId: null };
const TOKEN = "lpk_abcDEF123_-xyz";

function deps() {
  return {
    hash: (t: string) => `h:${t}`,
    findKey: vi.fn(async (h: string) => (h === `h:${TOKEN}` ? KEY : null)),
    record: vi.fn(async (_k: IngestKey, events: UsageEventInput[]) => ({ inserted: events.length })),
  } satisfies IngestDeps;
}

function req(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("http://x/api/v1/events", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = { events: [{ provider: "openai", model: "gpt-5-mini", inputTokens: 1200, outputTokens: 300, client: "acme" }] };

describe("handleIngest", () => {
  it("records a valid batch with the key's context and returns the inserted count", async () => {
    const d = deps();
    const res = await handleIngest(req(valid), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1 });
    expect(d.record).toHaveBeenCalledOnce();
    const [key, events] = d.record.mock.calls[0]!;
    expect(key).toBe(KEY);
    expect(events[0]).toMatchObject({ provider: "openai", cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("rejects a missing or non-lpk bearer token with 401", async () => {
    for (const auth of [null, "Bearer sk-live-123", "Basic abc", `Bearer${TOKEN}`]) {
      const d = deps();
      const res = await handleIngest(req(valid, auth), d);
      expect(res.status).toBe(401);
      expect(d.findKey).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown or revoked key with 401", async () => {
    const d = deps();
    const res = await handleIngest(req(valid, "Bearer lpk_unknown"), d);
    expect(res.status).toBe(401);
    expect(d.record).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await handleIngest(req("{not json"), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/);
  });

  it("returns 400 with zod issues for schema violations", async () => {
    const cases: [unknown, string][] = [
      [{}, "events"],
      [{ events: [] }, "events"],
      [{ events: [{ provider: "nope", model: "x" }] }, "provider"],
      [{ events: [{ provider: "openai", model: "" }] }, "model"],
      [{ events: [{ provider: "openai", model: "m", inputTokens: -1 }] }, "inputTokens"],
      [{ events: [{ provider: "openai", model: "m", outputTokens: 1.5 }] }, "outputTokens"],
      [{ events: Array.from({ length: 1001 }, () => ({ provider: "openai", model: "m" })) }, "events"],
    ];
    for (const [body, path] of cases) {
      const d = deps();
      const res = await handleIngest(req(body), d);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { issues: { path: (string | number)[] }[] };
      expect(json.issues.length).toBeGreaterThan(0);
      expect(json.issues.some((i) => i.path.includes(path))).toBe(true);
      expect(d.record).not.toHaveBeenCalled();
    }
  });

  it("coerces ISO timestamps to dates", async () => {
    const d = deps();
    await handleIngest(req({ events: [{ provider: "anthropic", model: "claude-haiku-4-5", ts: "2026-09-30T10:00:00Z" }] }), d);
    expect(d.record.mock.calls[0]![1][0]!.ts).toBeInstanceOf(Date);
  });
});
