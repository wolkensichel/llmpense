/**
 * Billing currencies against the real Postgres from DATABASE_URL: rate selection from stored
 * rates, manual overrides, closing and reopening with frozen rates, missing rates, fixed-fee
 * losses in another currency and the ECB sync. Uses its own org (slug `currency-test`) and rates
 * dated in 2091, which no real feed contains; both are deleted afterwards.
 */
import { and, eq, gte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UsageEventInput } from "@llmpense/core";
import { createDb, type Db } from "./client.ts";
import { fxResolver, latestEcbRateDate, syncEcbRates, upsertEurRates } from "./fx.ts";
import { evaluateFixedFeeLosses, recordEvents } from "./record.ts";
import { clients, fxRateOverrides, fxRates, orgs, statementLines, statements } from "./schema.ts";
import { closeAllDrafts, closeStatement, getClientStatement, listMonthStatements, reopenStatement } from "./statements.ts";

const ORG_SLUG = "currency-test";
const hasDb = !!process.env.DATABASE_URL;
const MAR = "2091-03";
const AFTER = new Date("2091-04-10T12:00:00Z");

let db: Db;
let orgId: string;
const ids: Record<string, string> = {};

const ev = (client: string, o: Partial<UsageEventInput> = {}): UsageEventInput => ({
  ts: new Date("2091-03-10T10:00:00Z"),
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

const rates = (date: string, r: Record<string, number>, source = "test") =>
  Object.entries(r).map(([currency, ratePerEur]) => ({ date, currency, ratePerEur, source }));

describe.skipIf(!hasDb)("billing currencies (db)", () => {
  beforeAll(async () => {
    db = createDb();
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.delete(fxRates).where(gte(fxRates.date, "2091-01-01"));
    const [org] = await db.insert(orgs).values({ name: "Currency test", slug: ORG_SLUG }).returning();
    orgId = org!.id;
    for (const [slug, mode, markup, fee, currency] of [
      ["euro-fixed", "fixed", "0", "150", "EUR"],
      ["yen-markup", "markup", "50", "0", "JPY"],
      ["pound-pass", "passthrough", "0", "0", "GBP"],
    ] as const) {
      const [c] = await db
        .insert(clients)
        .values({ orgId, slug, name: slug, billingMode: mode, markupPct: markup, fixedFee: fee, billingCurrency: currency })
        .returning();
      ids[slug] = c!.id;
    }
    // Rates in early and late March; the April rate must never be used for March.
    await upsertEurRates(db, [
      ...rates("2091-03-02", { USD: 1.2, JPY: 180, GBP: 0.96 }),
      ...rates("2091-03-28", { USD: 1.2, JPY: 180, GBP: 0.96 }),
      ...rates("2091-03-30", { USD: 1.25, JPY: 187.5, GBP: 1 }),
      ...rates("2091-04-02", { USD: 2, JPY: 300 }),
    ]);
    await recordEvents(db, { orgId, source: "seed" }, [
      ev("euro-fixed", { costUsd: 40 }),
      ev("yen-markup", { costUsd: 1.001 }), // billed 1.5015 USD
      ev("yen-markup", { costUsd: 2.002, model: "gpt-5" }), // billed 3.003 USD
      ev("pound-pass", { costUsd: 3 }),
    ]);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(orgs).where(eq(orgs.slug, ORG_SLUG));
    await db.delete(fxRates).where(gte(fxRates.date, "2091-01-01"));
    await db.$client.end();
  });

  it("picks the last stored rate on or before the month end", async () => {
    const fx = await fxResolver(db, orgId, [MAR], AFTER);
    expect(fx("EUR", MAR)).toMatchObject({ date: "2091-03-30", perUsd: 0.8, source: "ecb" });
    expect(fx("JPY", MAR)!.perUsd).toBeCloseTo(150, 10);
    expect(fx("GBP", MAR)!.perUsd).toBeCloseTo(0.8, 10);
    expect(fx("USD", MAR)!.perUsd).toBe(1);
  });

  it("converts drafts per line, with the fixed fee in EUR", async () => {
    const eur = (await getClientStatement(db, orgId, ids["euro-fixed"]!, MAR, AFTER))!;
    expect(eur.status).toBe("draft");
    expect(eur.data.terms).toEqual({ billingMode: "fixed", markupPct: 0, fixedFee: 150, currency: "EUR" });
    expect(eur.data.totals).toMatchObject({ fixedFee: 150, totalBilled: 150, fixedFeeUsd: 187.5, totalBilledUsd: 187.5, costUsd: 40, marginUsd: 147.5 });

    const yen = (await getClientStatement(db, orgId, ids["yen-markup"]!, MAR, AFTER))!;
    // 3.003 * 150 = 450.45 -> 450; 1.5015 * 150 = 225.225 -> 225 (sorted: gpt-5 first)
    expect(yen.data.lines.map((l) => l.billed)).toEqual([450, 225]);
    expect(yen.data.totals.totalBilled).toBe(675);
  });

  it("lets a manual rate win over the stored reference rate", async () => {
    const [o] = await db.insert(fxRateOverrides).values({ orgId, currency: "EUR", ratePerUsd: "0.9", effectiveFrom: "2091-03-15" }).returning();
    const eur = (await getClientStatement(db, orgId, ids["euro-fixed"]!, MAR, AFTER))!;
    expect(eur.data.fx).toEqual({ currency: "EUR", perUsd: 0.9, date: "2091-03-15", source: "manual" });
    expect(eur.data.totals.fixedFeeUsd).toBe(166.67);
    await db.delete(fxRateOverrides).where(eq(fxRateOverrides.id, o!.id));
  });

  it("refuses to close a statement whose currency has no rate (before any stored rate)", async () => {
    const gbp = (await getClientStatement(db, orgId, ids["pound-pass"]!, "1998-12", AFTER))!;
    expect(gbp.data.fx).toBeNull();
    expect(gbp.data.totals.totalBilled).toBeNull();
    expect(await closeStatement(db, orgId, ids["pound-pass"]!, "1998-12", AFTER)).toBe("no_rate");
  });

  it("freezes the rate with the converted amounts on close, and drops them on reopen", async () => {
    expect(await closeStatement(db, orgId, ids["euro-fixed"]!, MAR, AFTER)).toBe("closed");
    const row = await db.query.statements.findFirst({ where: and(eq(statements.clientId, ids["euro-fixed"]!), eq(statements.period, MAR)) });
    expect(row).toMatchObject({ currency: "EUR", fxDate: "2091-03-30", fxSource: "ecb", totalBilled: "150.00", monthlyFee: "150.00000000" });
    expect(Number(row!.fxRate)).toBe(0.8);
    const lines = await db.select().from(statementLines).where(eq(statementLines.statementId, row!.id));
    expect(lines.find((l) => l.kind === "fixed_fee")).toMatchObject({ billed: "150.00", billedUsd: "187.50000000" });

    // A later rate for 31 March and a new fee in another currency don't touch the closed statement.
    await upsertEurRates(db, rates("2091-03-31", { USD: 1.5, JPY: 150 }));
    await db.update(clients).set({ fixedFee: "200", billingCurrency: "JPY" }).where(eq(clients.id, ids["euro-fixed"]!));
    const closed = (await getClientStatement(db, orgId, ids["euro-fixed"]!, MAR, AFTER))!;
    expect(closed.status).toBe("closed");
    expect(closed.data.fx).toEqual({ currency: "EUR", perUsd: 0.8, date: "2091-03-30", source: "ecb" });
    expect(closed.data.terms).toEqual({ billingMode: "fixed", markupPct: 0, fixedFee: 150, currency: "EUR" });
    expect(closed.data.totals).toMatchObject({ totalBilled: 150, totalBilledUsd: 187.5 });
    await db.update(clients).set({ fixedFee: "150", billingCurrency: "EUR" }).where(eq(clients.id, ids["euro-fixed"]!));

    expect(await reopenStatement(db, orgId, ids["euro-fixed"]!, MAR, AFTER)).toBe("reopened");
    const reopenedRow = await db.query.statements.findFirst({ where: eq(statements.id, row!.id) });
    expect(reopenedRow).toMatchObject({ status: "draft", currency: null, fxRate: null, fxDate: null, fxSource: null, totalBilled: null });
    const live = (await getClientStatement(db, orgId, ids["euro-fixed"]!, MAR, AFTER))!;
    // Live again with the newest rate of the month: 1 USD = 1 / 1.5 EUR.
    expect(live.data.fx!.date).toBe("2091-03-31");
    expect(live.data.totals.fixedFeeUsd).toBe(225);
  });

  it("closes all drafts that have a rate and reports the rest", async () => {
    expect(await closeAllDrafts(db, orgId, MAR, AFTER)).toEqual({ closed: 3, noRate: 0 });
    const list = await listMonthStatements(db, orgId, MAR, AFTER);
    expect(list.map((s) => [s.client.id, s.status])).toEqual([
      [ids["euro-fixed"], "closed"],
      [ids["yen-markup"], "closed"],
      [ids["pound-pass"], "closed"],
    ]);
    const yen = list.find((s) => s.client.id === ids["yen-markup"])!;
    // Closed with the 31 March rate added above: 1 USD = 150 / 1.5 = 100 JPY.
    expect(yen.data.lines.map((l) => l.billed)).toEqual([300, 150]);
    expect(yen.data.fx!.date).toBe("2091-03-31");
  });

  it("checks fixed-fee losses against the fee converted at the month's rate", async () => {
    const at = new Date("2091-03-16T00:00:00Z");
    await recordEvents(db, { orgId, source: "seed" }, [ev("euro-fixed", { ts: new Date("2091-03-12T00:00:00Z"), costUsd: 60 })]);
    // 100 USD of cost by 16 March 00:00; 15 of 31 days of the 150 EUR fee are earned. The latest
    // rate by then is 2 March (1 EUR = 1.2 USD), so the fee to date is 150 * 15/31 * 1.2 = 87.10 USD.
    const fired = await evaluateFixedFeeLosses(db, orgId, at);
    expect(fired).toHaveLength(1);
    expect(Number(fired[0]!.spendUsd)).toBe(100);
    expect(Number(fired[0]!.feeUsd)).toBeCloseTo(150 * (15 / 31) * 1.2, 4);
  });

  it("syncs ECB feeds idempotently", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref"><gesmes:subject>Reference rates</gesmes:subject><Cube><Cube time="2091-05-04"><Cube currency="USD" rate="1.1"/><Cube currency="SEK" rate="11"/><Cube currency="GBP" rate="0.8"/></Cube></Cube></gesmes:Envelope>`;
    const fetch = async () => new Response(xml);
    const first = await syncEcbRates(db, { feed: "daily", fetch });
    expect(first).toEqual({ feed: "daily", received: 2, written: 2, latestDate: "2091-05-04" });
    await syncEcbRates(db, { feed: "daily", fetch });
    const stored = await db.select().from(fxRates).where(eq(fxRates.date, "2091-05-04"));
    expect(stored.map((r) => [r.currency, Number(r.ratePerEur), r.source]).sort()).toEqual([
      ["GBP", 0.8, "ecb"],
      ["USD", 1.1, "ecb"],
    ]);
    expect(await latestEcbRateDate(db)).toBe("2091-05-04");
    await expect(syncEcbRates(db, { feed: "daily", fetch: async () => new Response("<html/>") })).rejects.toThrow(/Not an ECB/);
  });
});
