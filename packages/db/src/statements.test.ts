/**
 * Statements and fixed-fee loss alerts against the real Postgres from DATABASE_URL.
 * Uses its own org (slug `statements-test`) and deletes it afterwards.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageEventInput } from "@llmpense/core";
import { createDb, type Db } from "./client.ts";
import { evaluateAlerts, evaluateFixedFeeLosses, recordEvents } from "./record.ts";
import { alerts, budgets, clients, orgs, statementLines, statements } from "./schema.ts";
import { closeAllDrafts, closeStatement, getClientStatement, listMonthStatements, reopenStatement } from "./statements.ts";

const ORG_SLUG = "statements-test";
const hasDb = !!process.env.DATABASE_URL;

let db: Db;
let orgId: string;
const ids: Record<string, string> = {};

const AUG = "2026-08";
const IN_SEP = new Date("2026-09-15T12:00:00Z");

const ev = (client: string, o: Partial<UsageEventInput> = {}): UsageEventInput => ({
  ts: new Date("2026-08-10T10:00:00Z"),
  provider: "openai",
  model: "gpt-5-mini",
  client,
  project: "bot",
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 1,
  ...o,
});

async function setBilling(slug: string, billingMode: "markup" | "fixed" | "passthrough" | "absorbed", markupPct = "0", fixedFee = "0") {
  await db.update(clients).set({ billingMode, markupPct, fixedFee }).where(eq(clients.id, ids[slug]!));
}

describe.skipIf(!hasDb)("statements (db)", () => {
  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    const [org] = await db.insert(orgs).values({ name: "Statements test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
    for (const [slug, mode, markup, fee] of [
      ["acme", "markup", "30", "0"],
      ["northwind", "fixed", "0", "300"],
      ["globex", "passthrough", "0", "0"],
    ] as const) {
      const [c] = await db.insert(clients).values({ orgId, slug, name: slug.toUpperCase(), billingMode: mode, markupPct: markup, fixedFee: fee }).returning();
      ids[slug] = c!.id;
    }
    await recordEvents(db, { orgId, source: "seed" }, [
      ev("acme", { costUsd: 10 }),
      ev("acme", { costUsd: 5, model: "gpt-5" }),
      ev("acme", { costUsd: 2.5, project: "search" }),
      ev("northwind", { costUsd: 40 }),
      ev("globex", { costUsd: 3 }),
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.$client.end();
  });

  it("computes a live draft from usage with billed amounts frozen at ingest", async () => {
    const s = (await getClientStatement(db, orgId, ids.acme!, AUG, IN_SEP))!;
    expect(s.status).toBe("draft");
    expect(s.data.lines).toHaveLength(3);
    expect(s.data.totals).toMatchObject({ requests: 3, costUsd: 17.5, usageBilledUsd: 22.75, totalBilledUsd: 22.75 });
  });

  it("refuses to close a month that has not ended", async () => {
    expect(await closeStatement(db, orgId, ids.acme!, "2026-09", IN_SEP)).toBe("not_ended");
  });

  it("closing freezes totals and lines against later usage, price and billing changes", async () => {
    expect(await closeStatement(db, orgId, ids.acme!, AUG, IN_SEP)).toBe("closed");
    expect(await closeStatement(db, orgId, ids.acme!, AUG, IN_SEP)).toBe("already_closed");

    // A late event for August arrives and the client moves to a fixed fee.
    await recordEvents(db, { orgId, source: "seed" }, [ev("acme", { costUsd: 100 })]);
    await setBilling("acme", "fixed", "0", "999");

    const s = (await getClientStatement(db, orgId, ids.acme!, AUG, IN_SEP))!;
    expect(s.status).toBe("closed");
    expect(s.closedAt).toEqual(IN_SEP);
    expect(s.data.terms).toEqual({ billingMode: "markup", markupPct: 30, fixedFee: 0, currency: "USD" });
    expect(s.data.totals).toMatchObject({ requests: 3, costUsd: 17.5, totalBilledUsd: 22.75, fixedFeeUsd: 0 });
    expect(s.data.lines.map((l) => l.billedUsd)).toEqual([6.5, 13, 3.25]);
    expect(s.client.name).toBe("ACME");
  });

  it("reopening returns the statement to a live draft", async () => {
    expect(await reopenStatement(db, orgId, ids.acme!, AUG, IN_SEP)).toBe("reopened");
    expect(await reopenStatement(db, orgId, ids.acme!, AUG, IN_SEP)).toBe("not_closed");
    const row = await db.query.statements.findFirst({ where: and(eq(statements.clientId, ids.acme!), eq(statements.period, AUG)) });
    expect(row).toMatchObject({ status: "draft", closedAt: null, totalBilledUsd: null });
    expect(row!.reopenedAt).toEqual(IN_SEP);
    expect(await db.select().from(statementLines).where(eq(statementLines.statementId, row!.id))).toEqual([]);

    const s = (await getClientStatement(db, orgId, ids.acme!, AUG, IN_SEP))!;
    expect(s.status).toBe("draft");
    expect(s.reopenedAt).toEqual(IN_SEP);
    // Live again: the late event counts and the new fixed fee applies to the whole month.
    expect(s.data.totals.requests).toBe(4);
    expect(s.data.totals.fixedFeeUsd).toBe(999);
    await setBilling("acme", "markup", "30");
  });

  it("closes all drafts of a month, including the fixed fee line", async () => {
    expect(await closeAllDrafts(db, orgId, "2026-09", IN_SEP)).toEqual({ closed: 0, noRate: 0 });
    expect(await closeAllDrafts(db, orgId, AUG, IN_SEP)).toEqual({ closed: 3, noRate: 0 });
    expect(await closeAllDrafts(db, orgId, AUG, IN_SEP)).toEqual({ closed: 0, noRate: 0 });
    const list = await listMonthStatements(db, orgId, AUG, IN_SEP);
    expect(list.map((s) => s.status)).toEqual(["closed", "closed", "closed"]);
    const nw = list.find((s) => s.client.id === ids.northwind)!;
    expect(nw.data.lines.at(-1)).toMatchObject({ kind: "fixed_fee", billedUsd: 300 });
    expect(nw.data.totals).toMatchObject({ costUsd: 40, totalBilledUsd: 300, marginUsd: 260, fixedFeeUsd: 300 });
  });

  it("raises a fixed-fee loss alert once per client and month", async () => {
    // Sep 1-15.5 earns 300 * 14.5/30 = 145 of the fee; 150 of cost is a loss.
    await recordEvents(db, { orgId, source: "seed" }, [ev("northwind", { ts: new Date("2026-09-03T00:00:00Z"), costUsd: 150 })]);
    const fired = await evaluateFixedFeeLosses(db, orgId, IN_SEP);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ kind: "fixed_fee_loss", clientId: ids.northwind, periodStart: "2026-09-01", budgetId: null, threshold: null });
    expect(Number(fired[0]!.spendUsd)).toBe(150);
    expect(Number(fired[0]!.feeUsd)).toBe(145);

    expect(await evaluateFixedFeeLosses(db, orgId, new Date("2026-09-16T00:00:00Z"))).toEqual([]);
    // Earlier in the month the fee to date was lower still, but the alert does not repeat.
    expect(await evaluateAlerts(db, orgId, IN_SEP)).toEqual([]);
  });

  it("does not flag a fixed-fee client whose fee to date covers its cost", async () => {
    // August: 40 of cost against the whole 300 fee.
    expect(await evaluateFixedFeeLosses(db, orgId, new Date("2026-08-31T00:00:00Z"))).toEqual([]);
  });

  it("evaluates budgets and fixed-fee losses together", async () => {
    await db.insert(budgets).values({ orgId, scope: "client", clientId: ids.globex!, amountUsd: "2", thresholds: [100] });
    const fired = await evaluateAlerts(db, orgId, new Date("2026-08-20T00:00:00Z"));
    expect(fired.map((a) => a.kind)).toEqual(["budget"]);
    const all = await db.select().from(alerts).where(eq(alerts.orgId, orgId));
    expect(all.filter((a) => a.kind === "fixed_fee_loss")).toHaveLength(1);
  });

  it("recording live events triggers the fixed-fee loss check", async () => {
    await setBilling("globex", "fixed", "0", "1");
    await recordEvents(db, { orgId, source: "ingest" }, [ev("globex", { ts: new Date(), costUsd: 50 })]);
    const row = await db.query.alerts.findFirst({ where: and(eq(alerts.clientId, ids.globex!), eq(alerts.kind, "fixed_fee_loss")) });
    expect(row).toBeDefined();
  });
});
