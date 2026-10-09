/**
 * Event recording against the real Postgres from DATABASE_URL.
 * Uses its own org (slug `record-test`) and deletes it afterwards.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client.ts";
import { recordEvents } from "./record.ts";
import { orgs, usageEvents } from "./schema.ts";

const ORG_SLUG = "record-test";
const hasDb = !!process.env.DATABASE_URL;

let db: Db;
let orgId: string;

describe.skipIf(!hasDb)("recordEvents pricing fallback", () => {
  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Record test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
  });

  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.$client.end();
  });

  const base = { provider: "azure" as const, model: "no-such-model-xyz", inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it("uses the reported cost when no price matches, and keeps the event flagged", async () => {
    await recordEvents(db, { orgId, source: "ingest" }, [
      { ...base, requestId: "fallback-1", metadata: { integration: "litellm", reportedCostUsd: 0.0123 } },
    ]);
    const [row] = await db.select().from(usageEvents).where(eq(usageEvents.requestId, "fallback-1"));
    expect(Number(row!.costUsd)).toBeCloseTo(0.0123, 8);
    expect(row!.priced).toBe(false);
    expect(row!.metadata).toMatchObject({ costSource: "reported", reportedCostUsd: 0.0123 });
  });

  it("stores zero cost when neither a price nor a valid reported cost exists", async () => {
    await recordEvents(db, { orgId, source: "ingest" }, [
      { ...base, requestId: "fallback-2", metadata: { reportedCostUsd: -5 } },
      { ...base, requestId: "fallback-3" },
    ]);
    const rows = await db.select().from(usageEvents).where(eq(usageEvents.orgId, orgId));
    for (const id of ["fallback-2", "fallback-3"]) {
      const r = rows.find((x) => x.requestId === id)!;
      expect(Number(r.costUsd)).toBe(0);
      expect(r.priced).toBe(false);
      expect(r.metadata?.costSource).toBeUndefined();
    }
  });

  it("prefers the price table over a reported cost when a price exists", async () => {
    await recordEvents(db, { orgId, source: "ingest" }, [
      { ...base, provider: "anthropic", model: "claude-opus-5-5", requestId: "fallback-4", metadata: { reportedCostUsd: 99 } },
    ]);
    const [row] = await db.select().from(usageEvents).where(eq(usageEvents.requestId, "fallback-4"));
    expect(row!.priced).toBe(true);
    expect(Number(row!.costUsd)).toBeCloseTo((100 * 4 + 10 * 20) / 1_000_000, 8);
  });
});
