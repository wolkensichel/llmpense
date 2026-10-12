/**
 * Statement lifecycle and numbering against the real Postgres from DATABASE_URL.
 * Uses its own org (slug `invoicing-test`) and deletes it afterwards.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageEventInput } from "@llmpense/core";
import { createDb, type Db } from "./client.ts";
import { recordEvents } from "./record.ts";
import { clients, orgs, statementCounters, statements } from "./schema.ts";
import { closeStatement, getClientStatement, markStatement, markStatements, reopenStatement, statementHistory } from "./statements.ts";

const ORG_SLUG = "invoicing-test";
const hasDb = !!process.env.DATABASE_URL;

let db: Db;
let orgId: string;
const ids: string[] = [];

const AUG = "2026-08";
const SEP = "2026-09";
const CLOSE_AT = new Date("2026-10-02T09:00:00Z");

const ev = (client: string, ts: string): UsageEventInput => ({
  ts: new Date(ts),
  provider: "openai",
  model: "gpt-5-mini",
  client,
  project: "bot",
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 2,
});

describe.skipIf(!hasDb)("statement lifecycle and numbers (db)", () => {
  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Invoicing test", slug: ORG_SLUG, statementNumberFormat: "T-{YYYY}-{NNN}", paymentTermsDays: 14 }).returning();
    orgId = org!.id;
    for (let i = 0; i < 6; i++) {
      const [c] = await db
        .insert(clients)
        .values({ orgId, slug: `c${i}`, name: `Client ${i}`, billingMode: "markup", markupPct: "10", paymentTermsDays: i === 0 ? 30 : null })
        .returning();
      ids.push(c!.id);
    }
    await recordEvents(
      db,
      { orgId, source: "seed" },
      ids.flatMap((_, i) => [ev(`c${i}`, "2026-08-10T10:00:00Z"), ev(`c${i}`, "2026-09-10T10:00:00Z")]),
    );
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.$client.end();
  });

  it("assigns a number, issue date and due date on the first close", async () => {
    expect(await closeStatement(db, orgId, ids[0]!, AUG, CLOSE_AT)).toBe("closed");
    const s = (await getClientStatement(db, orgId, ids[0]!, AUG, CLOSE_AT))!;
    expect(s.status).toBe("closed");
    expect(s.invoice).toMatchObject({ number: "T-2026-001", issueDate: "2026-10-02", paymentTermsDays: 30, dueDate: "2026-11-01" });
  });

  it("uses the org's payment terms when the client has none", async () => {
    expect(await closeStatement(db, orgId, ids[1]!, AUG, CLOSE_AT)).toBe("closed");
    const s = (await getClientStatement(db, orgId, ids[1]!, AUG, CLOSE_AT))!;
    expect(s.invoice).toMatchObject({ number: "T-2026-002", paymentTermsDays: 14, dueDate: "2026-10-16" });
  });

  it("keeps the number when a statement is reopened and closed again", async () => {
    expect(await reopenStatement(db, orgId, ids[1]!, AUG, new Date("2026-10-03T09:00:00Z"))).toBe("reopened");
    const draft = (await getClientStatement(db, orgId, ids[1]!, AUG, CLOSE_AT))!;
    expect(draft.status).toBe("draft");
    expect(draft.invoice.number).toBe("T-2026-002");
    expect(draft.invoice.issueDate).toBeNull();
    expect(await closeStatement(db, orgId, ids[1]!, AUG, new Date("2026-10-05T09:00:00Z"))).toBe("closed");
    const again = (await getClientStatement(db, orgId, ids[1]!, AUG, CLOSE_AT))!;
    expect(again.invoice).toMatchObject({ number: "T-2026-002", issueDate: "2026-10-05", dueDate: "2026-10-19" });
  });

  it("moves through sent and paid, and refuses to reopen until unmarked", async () => {
    const c = ids[0]!;
    expect(await markStatement(db, orgId, c, AUG, "mark_paid")).toBe("not_allowed");
    expect(await markStatement(db, orgId, c, AUG, "mark_sent", { issueDate: "2026-08-31" })).toBe("invalid_date");
    expect(await markStatement(db, orgId, c, AUG, "mark_sent", { issueDate: "2026-10-06", now: new Date("2026-10-06T08:00:00Z") })).toBe("done");
    let s = (await getClientStatement(db, orgId, c, AUG, CLOSE_AT))!;
    expect(s.status).toBe("sent");
    expect(s.invoice).toMatchObject({ issueDate: "2026-10-06", dueDate: "2026-11-05" });
    expect(s.invoice.sentAt?.toISOString()).toBe("2026-10-06T08:00:00.000Z");
    // The snapshot stays frozen.
    expect(s.data.totals.totalBilledUsd).toBe(2.2);

    expect(await reopenStatement(db, orgId, c, AUG)).toBe("not_closed");
    expect(await markStatement(db, orgId, c, AUG, "mark_paid", { now: new Date("2026-10-07T08:00:00Z") })).toBe("done");
    expect(await reopenStatement(db, orgId, c, AUG)).toBe("not_closed");
    expect(await markStatement(db, orgId, c, AUG, "unmark_sent")).toBe("not_allowed");
    expect(await markStatement(db, orgId, c, AUG, "unmark_paid")).toBe("done");
    expect(await markStatement(db, orgId, c, AUG, "unmark_sent")).toBe("done");
    s = (await getClientStatement(db, orgId, c, AUG, CLOSE_AT))!;
    expect(s.status).toBe("closed");
    expect(s.invoice.sentAt).toBeNull();
    expect(s.invoice.paidAt).toBeNull();
    expect(await reopenStatement(db, orgId, c, AUG)).toBe("reopened");

    const history = await statementHistory(db, orgId, c, AUG);
    expect(history.map((h) => h.action)).toEqual(["close", "mark_sent", "mark_paid", "unmark_paid", "unmark_sent", "reopen"]);
  });

  it("marks several statements at once and skips the ones it doesn't apply to", async () => {
    expect(await closeStatement(db, orgId, ids[2]!, AUG, CLOSE_AT)).toBe("closed");
    const r = await markStatements(db, orgId, AUG, [ids[1]!, ids[2]!, ids[3]!], "mark_sent");
    expect(r).toEqual({ done: 2, skipped: 1, invalidDate: false });
  });

  it("gives concurrent closes consecutive numbers without gaps or collisions", async () => {
    // September of six clients, closed at the same time on separate connections.
    const results = await Promise.all(ids.map((id) => closeStatement(db, orgId, id, SEP, CLOSE_AT)));
    expect(results.every((r) => r === "closed")).toBe(true);
    const rows = await db.select({ number: statements.number }).from(statements).where(and(eq(statements.orgId, orgId), eq(statements.period, SEP)));
    const numbers = rows.map((r) => r.number!).sort();
    // AUG used 001-003; client 0's August statement kept 001 after it was reopened.
    expect(numbers).toEqual(["T-2026-004", "T-2026-005", "T-2026-006", "T-2026-007", "T-2026-008", "T-2026-009"]);
    const [counter] = await db.select().from(statementCounters).where(eq(statementCounters.orgId, orgId));
    expect(counter).toMatchObject({ year: 2026, lastValue: 9 });
  });

  it("starts a new counter in a new year when the format has a year", async () => {
    await db.insert(clients).values({ orgId, slug: "late", name: "Late", billingMode: "markup", markupPct: "0" });
    const late = (await db.query.clients.findFirst({ where: and(eq(clients.orgId, orgId), eq(clients.slug, "late")) }))!;
    await recordEvents(db, { orgId, source: "seed" }, [ev("late", "2026-12-10T10:00:00Z")]);
    expect(await closeStatement(db, orgId, late.id, "2026-12", new Date("2027-01-04T09:00:00Z"))).toBe("closed");
    const s = (await getClientStatement(db, orgId, late.id, "2026-12", new Date("2027-01-04T09:00:00Z")))!;
    expect(s.invoice.number).toBe("T-2027-001");
  });
});
