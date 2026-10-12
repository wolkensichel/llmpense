import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { OutcomeInput } from "@llmpense/core";
import { apiKeys, createDb, generateApiKey, orgs, outcomes, type Db } from "@llmpense/db";
import type { IngestKey } from "./ingest.ts";
import { dbOutcomeDeps } from "./ingest-db.ts";
import { handleOutcomes, type OutcomeDeps } from "./outcomes.ts";

const KEY: IngestKey = { id: "k1", orgId: "o1", defaultClientId: null, defaultProjectId: null };
const TOKEN = "lpk_abcDEF123_-xyz";

function deps() {
  return {
    hash: (t: string) => `h:${t}`,
    findKey: vi.fn(async (h: string) => (h === `h:${TOKEN}` ? KEY : null)),
    upsert: vi.fn(async (_k: IngestKey, list: OutcomeInput[]) => list.length),
  } satisfies OutcomeDeps;
}

function req(body: unknown, auth: string | null = `Bearer ${TOKEN}`) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) headers.authorization = auth;
  return new Request("http://x/api/v1/outcomes", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

const one = { runId: "ticket-1", name: "ticket_resolved", status: "success", value: { amount: 4, currency: "USD" } };

describe("handleOutcomes", () => {
  it("upserts a valid batch for the key and reports counts", async () => {
    const d = deps();
    const res = await handleOutcomes(req({ outcomes: [one, { runId: "ticket-2", name: "ticket_resolved", status: "failure", ts: "2026-10-01T10:00:00Z" }] }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 2, upserted: 2 });
    const [key, list] = d.upsert.mock.calls[0]!;
    expect(key).toBe(KEY);
    expect(list[1]!.ts).toBeInstanceOf(Date);
  });

  it("returns 401 for a missing, non-lpk or unknown key", async () => {
    for (const auth of [null, "Bearer sk-live", "Basic abc", "Bearer lpk_unknown"]) {
      const d = deps();
      const res = await handleOutcomes(req({ outcomes: [one] }, auth), d);
      expect(res.status).toBe(401);
      expect(d.upsert).not.toHaveBeenCalled();
    }
  });

  it("returns 400 for malformed JSON and schema violations", async () => {
    expect((await handleOutcomes(req("{nope"), deps())).status).toBe(400);
    const cases: [unknown, string][] = [
      [{}, "outcomes"],
      [{ outcomes: [] }, "outcomes"],
      [{ outcomes: [{ ...one, runId: "" }] }, "runId"],
      [{ outcomes: [{ ...one, name: "not a name" }] }, "name"],
      [{ outcomes: [{ ...one, status: "resolved" }] }, "status"],
      [{ outcomes: [{ ...one, value: { amount: -1, currency: "USD" } }] }, "amount"],
      [{ outcomes: [{ ...one, value: { amount: 1, currency: "SEK" } }] }, "currency"],
      [{ outcomes: [{ ...one, ts: "yesterday" }] }, "ts"],
      [{ outcomes: Array.from({ length: 1001 }, () => one) }, "outcomes"],
    ];
    for (const [body, path] of cases) {
      const d = deps();
      const res = await handleOutcomes(req(body), d);
      expect(res.status).toBe(400);
      const out = (await res.json()) as { issues: { path: (string | number)[] }[] };
      expect(out.issues.some((i) => i.path.includes(path))).toBe(true);
      expect(d.upsert).not.toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------- against Postgres
// Uses its own org (slug `results-test`) and deletes it afterwards.

const ORG_SLUG = "results-test";

describe.skipIf(!process.env.DATABASE_URL)("POST /api/v1/outcomes with Postgres", () => {
  let db: Db;
  let orgId: string;
  let key: string;

  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Results test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
    const k = generateApiKey();
    key = k.key;
    await db.insert(apiKeys).values({ orgId, name: "results test", prefix: k.prefix, hash: k.hash });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.$client.end();
  });

  const post = (body: unknown) => handleOutcomes(req(body, `Bearer ${key}`), dbOutcomeDeps(db));
  const stored = () => db.select().from(outcomes).where(eq(outcomes.orgId, orgId));

  it("stores a batch and is idempotent per run and name", async () => {
    const batch = {
      outcomes: Array.from({ length: 250 }, (_, i) => ({
        runId: `run-${i}`,
        name: "document_reviewed",
        status: i % 10 === 0 ? "failure" : "success",
        value: { amount: 40, currency: "EUR" },
        ts: "2026-10-01T12:00:00Z",
      })),
    };
    expect(await (await post(batch)).json()).toEqual({ received: 250, upserted: 250 });
    expect(await (await post(batch)).json()).toEqual({ received: 250, upserted: 250 });
    const rows = await stored();
    expect(rows).toHaveLength(250);
    expect(rows.filter((r) => r.status === "failure")).toHaveLength(25);
    expect(rows[0]).toMatchObject({ valueAmount: "40.0000", valueCurrency: "EUR" });
  });

  it("updates an existing outcome and keeps other names of the same run separate", async () => {
    await post({ outcomes: [{ runId: "run-0", name: "document_reviewed", status: "success", metadata: { reviewer: "b" } }] });
    await post({ outcomes: [{ runId: "run-0", name: "client_approved", status: "success" }] });
    const run0 = await db.select().from(outcomes).where(and(eq(outcomes.orgId, orgId), eq(outcomes.runId, "run-0")));
    expect(run0).toHaveLength(2);
    const reviewed = run0.find((r) => r.name === "document_reviewed")!;
    expect(reviewed).toMatchObject({ status: "success", metadata: { reviewer: "b" }, valueAmount: null });
    // Re-reported without ts: the original outcome time stays.
    expect(reviewed.ts).toEqual(new Date("2026-10-01T12:00:00Z"));
  });
});
