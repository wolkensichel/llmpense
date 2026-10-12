/**
 * Outcomes and cost-per-result aggregates against the real Postgres from DATABASE_URL.
 * Uses its own org (slug `results-test`) and deletes it afterwards.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageEventInput } from "@llmpense/core";
import { createDb, type Db } from "./client.ts";
import { recordEvents } from "./record.ts";
import { MIXED_KEY, pendingRuns, resultBuckets, upsertOutcomes } from "./results.ts";
import { clients, fxRateOverrides, orgs, outcomes, usageEvents } from "./schema.ts";

const ORG_SLUG = "results-test";
const hasDb = !!process.env.DATABASE_URL;

let db: Db;
let orgId: string;

const T0 = new Date("2026-09-10T12:00:00Z");
const scope = () => ({ orgId, start: new Date("2026-09-01T00:00:00Z"), end: new Date("2026-10-01T00:00:00Z") });
const call = (runId: string, model: string, costUsd: number, client = "rt-acme"): UsageEventInput => ({
  provider: "openai",
  model,
  client,
  project: "bot",
  runId,
  costUsd,
  ts: T0,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

describe.skipIf(!hasDb)("cost per result", () => {
  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Results test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
    // 1 USD = 0.8 EUR for this org, so €10 = $12.50.
    await db.insert(fxRateOverrides).values({ orgId, currency: "EUR", ratePerUsd: "0.8", effectiveFrom: "2000-01-01" });

    await recordEvents(db, { orgId, source: "ingest" }, [
      call("r1", "model-a", 0.1),
      call("r1", "model-a", 0.2),
      call("r2", "model-a", 0.1),
      call("r3", "model-b", 0.2),
      call("r4", "model-a", 0.1),
      call("r4", "model-b", 0.3),
      call("r6", "model-a", 0.05),
      call("r8", "model-b", 0.5, "rt-globex"),
    ]);
    const at = new Date("2026-09-11T08:00:00Z");
    await upsertOutcomes(db, orgId, [
      { runId: "r1", name: "rt_done", status: "success", value: { amount: 10, currency: "EUR" }, ts: at },
      { runId: "r2", name: "rt_done", status: "failure", ts: at },
      { runId: "r3", name: "rt_done", status: "success", value: { amount: 5, currency: "USD" }, ts: at },
      { runId: "r4", name: "rt_done", status: "success", ts: at },
      // Reported before any usage arrived.
      { runId: "r5", name: "rt_done", status: "success", ts: at },
      { runId: "r1", name: "rt_other", status: "success", ts: at },
      { runId: "r8", name: "rt_done", status: "success", ts: at },
      // Outside the range.
      { runId: "r7", name: "rt_done", status: "success", ts: new Date("2026-08-15T00:00:00Z") },
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.$client.end();
  });

  it("stores the run id on usage events", async () => {
    const rows = await db.select().from(usageEvents).where(and(eq(usageEvents.orgId, orgId), eq(usageEvents.runId, "r1")));
    expect(rows).toHaveLength(2);
  });

  it("charges failed runs to the successes and converts values at the outcome day's rate", async () => {
    const [done, other] = await resultBuckets(db, scope());
    expect(done!.name).toBe("rt_done");
    expect(done).toMatchObject({ runs: 6, successes: 5, failures: 1, runsWithoutUsage: 1 });
    expect(done!.costUsd).toBeCloseTo(0.3 + 0.1 + 0.2 + 0.4 + 0.5, 8);
    expect(done!.costPerSuccess).toBeCloseTo(1.5 / 5, 8);
    expect(done!.costPerRun).toBeCloseTo(1.5 / 6, 8);
    expect(done!.successValueUsd).toBeCloseTo(12.5 + 5, 8);
    expect(done!.valuePerDollar).toBeCloseTo(17.5 / 1.5, 8);
    expect(done!.lowSample).toBe(true);
    // The same run's cost counts again under another outcome name.
    expect(other).toMatchObject({ name: "rt_other", runs: 1, successes: 1 });
    expect(other!.costUsd).toBeCloseTo(0.3, 8);
  });

  it("breaks down by model, client and day; runs mixing models get their own bucket", async () => {
    const byModel = await resultBuckets(db, { ...scope(), name: "rt_done" }, "model");
    const m = (key: string | null) => byModel.find((b) => b.key === key)!;
    expect(m("openai/model-a")).toMatchObject({ runs: 2, successes: 1, label: "model-a", sub: "openai" });
    expect(m("openai/model-a").costPerSuccess).toBeCloseTo(0.4, 8);
    expect(m("openai/model-b")).toMatchObject({ runs: 2, successes: 2 });
    expect(m(MIXED_KEY)).toMatchObject({ runs: 1, label: "Several models" });
    expect(m(null)).toMatchObject({ runs: 1, label: "No usage recorded yet", runsWithoutUsage: 1 });

    const byClient = await resultBuckets(db, { ...scope(), name: "rt_done" }, "client");
    const acme = await db.query.clients.findFirst({ where: and(eq(clients.orgId, orgId), eq(clients.slug, "rt-acme")) });
    expect(byClient.find((b) => b.key === acme!.id)).toMatchObject({ runs: 4, label: "rt-acme" });

    const byDay = await resultBuckets(db, { ...scope(), name: "rt_done" }, "day");
    expect(byDay).toHaveLength(1);
    expect(byDay[0]).toMatchObject({ key: "2026-09-11", runs: 6 });
  });

  it("filters to one client's runs", async () => {
    const acme = await db.query.clients.findFirst({ where: and(eq(clients.orgId, orgId), eq(clients.slug, "rt-acme")) });
    const [done] = await resultBuckets(db, { ...scope(), name: "rt_done", clientId: acme!.id });
    expect(done).toMatchObject({ runs: 4, successes: 3, failures: 1 });
    expect(done!.costPerSuccess).toBeCloseTo(1.0 / 3, 8);
  });

  it("counts runs with usage but no outcome as pending", async () => {
    const p = await pendingRuns(db, scope());
    expect(p.runs).toBe(1);
    expect(p.costUsd).toBeCloseTo(0.05, 8);
  });

  it("upserts per run and name: a repeated report updates, without ts it keeps the stored time", async () => {
    const before = await db.select().from(outcomes).where(and(eq(outcomes.orgId, orgId), eq(outcomes.runId, "r2")));
    expect(await upsertOutcomes(db, orgId, [{ runId: "r2", name: "rt_done", status: "success", metadata: { retry: true } }])).toBe(1);
    const after = await db.select().from(outcomes).where(and(eq(outcomes.orgId, orgId), eq(outcomes.runId, "r2")));
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "success", metadata: { retry: true } });
    expect(after[0]!.ts).toEqual(before[0]!.ts);
    const [done] = await resultBuckets(db, { ...scope(), name: "rt_done" });
    expect(done).toMatchObject({ runs: 6, successes: 6, failures: 0 });
  });

  it("keeps the last report of a run and name within one batch", async () => {
    const n = await upsertOutcomes(db, orgId, [
      { runId: "r9", name: "rt_batch", status: "failure", ts: T0 },
      { runId: "r9", name: "rt_batch", status: "success", ts: T0 },
    ]);
    expect(n).toBe(1);
    const [row] = await db.select().from(outcomes).where(and(eq(outcomes.orgId, orgId), eq(outcomes.runId, "r9")));
    expect(row!.status).toBe("success");
  });
});
