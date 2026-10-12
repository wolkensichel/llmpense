import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  buildStatement,
  cents,
  canClose,
  freezeStatement,
  isCurrency,
  parsePeriod,
  reopenStatement as reopenStored,
  resolveStatement,
  sourceKind,
  type Currency,
  type FxRate,
  type ModelNameDisplay,
  type ResolvedStatement,
  type StatementData,
  type StatementLine,
  type StatementTerms,
  type StoredStatement,
  type UsageLine,
} from "@llmpense/core";
import type { Db } from "./client.ts";
import { fxResolver, type FxResolver } from "./fx.ts";
import { clients, projects, statementLines, statements, usageEvents } from "./schema.ts";

type ClientRow = typeof clients.$inferSelect;

export interface ClientStatement extends ResolvedStatement {
  client: {
    id: string;
    name: string;
    slug: string;
    archived: boolean;
    /** The client's current setting for model names on client-facing statements. */
    modelNames: ModelNameDisplay | null;
  };
}

const n = (v: unknown) => Number(v ?? 0);
const nOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function termsOf(c: ClientRow): StatementTerms {
  return { billingMode: c.billingMode, markupPct: n(c.markupPct), fixedFee: n(c.fixedFee), currency: c.billingCurrency };
}

function mustPeriod(period: string) {
  const p = parsePeriod(period);
  if (!p) throw new Error(`Invalid period: ${period}`);
  return p;
}

/** Usage for a month aggregated per client, project and model. */
export async function monthUsageLines(db: Db, orgId: string, period: string, clientIds?: string[]) {
  const p = mustPeriod(period);
  const rows = await db
    .select({
      clientId: usageEvents.clientId,
      project: sql<string>`coalesce(${projects.name}, 'No project')`,
      provider: sql<string>`${usageEvents.provider}::text`,
      model: usageEvents.model,
      requests: sql<string>`count(*)`,
      inputTokens: sql<string>`sum(${usageEvents.inputTokens})`,
      outputTokens: sql<string>`sum(${usageEvents.outputTokens})`,
      cacheReadTokens: sql<string>`sum(${usageEvents.cacheReadTokens})`,
      cacheWriteTokens: sql<string>`sum(${usageEvents.cacheWriteTokens})`,
      costUsd: sql<string>`sum(${usageEvents.costUsd})`,
      billedUsd: sql<string>`sum(${usageEvents.billedUsd})`,
    })
    .from(usageEvents)
    .leftJoin(projects, eq(projects.id, usageEvents.projectId))
    .where(
      and(
        eq(usageEvents.orgId, orgId),
        gte(usageEvents.ts, p.start),
        lt(usageEvents.ts, p.end),
        clientIds ? inArray(usageEvents.clientId, clientIds) : sql`${usageEvents.clientId} is not null`,
      ),
    )
    .groupBy(usageEvents.clientId, projects.id, projects.name, usageEvents.provider, usageEvents.model);

  const byClient = new Map<string, UsageLine[]>();
  for (const r of rows) {
    const list = byClient.get(r.clientId!) ?? [];
    list.push({
      project: r.project,
      provider: r.provider,
      model: r.model,
      requests: n(r.requests),
      inputTokens: n(r.inputTokens),
      outputTokens: n(r.outputTokens),
      cacheReadTokens: n(r.cacheReadTokens),
      cacheWriteTokens: n(r.cacheWriteTokens),
      costUsd: n(r.costUsd),
      billedUsd: n(r.billedUsd),
    });
    byClient.set(r.clientId!, list);
  }
  return byClient;
}

type StatementRow = typeof statements.$inferSelect;
type LineRow = typeof statementLines.$inferSelect;

/** The frozen rate of a closed statement row. */
function storedRate(row: StatementRow): FxRate {
  const currency: Currency = isCurrency(row.currency) ? row.currency : "USD";
  if (currency === "USD") return { currency, perUsd: 1, date: null, source: "identity" };
  return { currency, perUsd: n(row.fxRate), date: row.fxDate, source: sourceKind(row.fxSource ?? "ecb") };
}

/** Rebuilds the frozen StatementData from stored columns and lines. */
function toStored(row: StatementRow, lines: LineRow[]): StoredStatement {
  if (row.status !== "closed") return { status: "draft", closedAt: null, reopenedAt: row.reopenedAt, snapshot: null };
  const fx = storedRate(row);
  const fixedFeeUsd = n(row.fixedFeeUsd);
  const totalBilledUsd = n(row.totalBilledUsd);
  const costUsd = n(row.costUsd);
  const marginUsd = cents(totalBilledUsd - costUsd);
  const snapshot: StatementData = {
    period: row.period,
    terms: { billingMode: row.billingMode ?? "markup", markupPct: n(row.markupPct), fixedFee: n(row.monthlyFee), currency: fx.currency },
    fx,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map(
        (l): StatementLine => ({
          kind: l.kind,
          project: l.project,
          provider: l.provider,
          model: l.model,
          requests: l.requests,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          cacheReadTokens: l.cacheReadTokens,
          cacheWriteTokens: l.cacheWriteTokens,
          costUsd: n(l.costUsd),
          billedUsd: n(l.billedUsd),
          billed: nOrNull(l.billed) ?? n(l.billedUsd),
        }),
      ),
    totals: {
      requests: n(row.requests),
      tokens: n(row.tokens),
      costUsd,
      usageBilledUsd: n(row.usageBilledUsd),
      fixedFeeUsd,
      totalBilledUsd,
      marginUsd,
      marginPct: totalBilledUsd > 0 ? marginUsd / totalBilledUsd : null,
      usageBilled: nOrNull(row.usageBilled) ?? n(row.usageBilledUsd),
      fixedFee: nOrNull(row.fixedFee) ?? fixedFeeUsd,
      totalBilled: nOrNull(row.totalBilled) ?? totalBilledUsd,
    },
    feeCoverage: lines.some((l) => l.kind === "fixed_fee") ? "full" : "none",
  };
  return { status: "closed", closedAt: row.closedAt, reopenedAt: row.reopenedAt, snapshot };
}

async function loadStored(db: Db, orgId: string, period: string, clientIds?: string[]) {
  const rows = await db
    .select()
    .from(statements)
    .where(and(eq(statements.orgId, orgId), eq(statements.period, period), clientIds ? inArray(statements.clientId, clientIds) : undefined));
  const closedIds = rows.filter((r) => r.status === "closed").map((r) => r.id);
  const lines = closedIds.length ? await db.select().from(statementLines).where(inArray(statementLines.statementId, closedIds)) : [];
  const out = new Map<string, { row: StatementRow; stored: StoredStatement }>();
  for (const r of rows) out.set(r.clientId, { row: r, stored: toStored(r, lines.filter((l) => l.statementId === r.id)) });
  return out;
}

function liveStatement(c: ClientRow, period: string, usage: UsageLine[], fx: FxResolver, now: Date) {
  const terms = termsOf(c);
  return buildStatement({ period, terms, usage, asOf: now, fx: fx(terms.currency, period) });
}

function resolveFor(
  c: ClientRow,
  period: string,
  usage: UsageLine[],
  stored: { row: StatementRow; stored: StoredStatement } | undefined,
  fx: FxResolver,
  now: Date,
): ClientStatement {
  const r = resolveStatement(stored?.stored, () => liveStatement(c, period, usage, fx, now));
  const name = r.status === "closed" ? (stored?.row.clientName ?? c.name) : c.name;
  return { ...r, client: { id: c.id, name, slug: c.slug, archived: c.archivedAt !== null, modelNames: c.modelNames } };
}

/** One client's statement for a month: the frozen snapshot if closed, otherwise computed live. */
export async function getClientStatement(db: Db, orgId: string, clientId: string, period: string, now = new Date()) {
  mustPeriod(period);
  const c = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) });
  if (!c) return null;
  const [usage, stored, fx] = await Promise.all([
    monthUsageLines(db, orgId, period, [c.id]),
    loadStored(db, orgId, period, [c.id]),
    fxResolver(db, orgId, [period], now),
  ]);
  return resolveFor(c, period, usage.get(c.id) ?? [], stored.get(c.id), fx, now);
}

/** Every client's statement for a month: active clients plus archived ones that have a stored statement. */
export async function listMonthStatements(db: Db, orgId: string, period: string, now = new Date()) {
  mustPeriod(period);
  const stored = await loadStored(db, orgId, period);
  const storedIds = [...stored.keys()];
  const list = await db
    .select()
    .from(clients)
    .where(and(eq(clients.orgId, orgId), storedIds.length ? or(isNull(clients.archivedAt), inArray(clients.id, storedIds)) : isNull(clients.archivedAt)))
    .orderBy(asc(clients.createdAt), asc(clients.name));
  const [usage, fx] = await Promise.all([monthUsageLines(db, orgId, period), fxResolver(db, orgId, [period], now)]);
  return list.map((c) => resolveFor(c, period, usage.get(c.id) ?? [], stored.get(c.id), fx, now));
}

export type CloseResult = "closed" | "already_closed" | "not_ended" | "not_found" | "no_rate";

/**
 * Freezes a client's statement for a month, with the exchange rate that applies to the month.
 * Runs in a transaction and takes a row lock, so two concurrent closes cannot both snapshot.
 * A closed statement is never re-snapshotted.
 */
export async function closeStatement(db: Db, orgId: string, clientId: string, period: string, now = new Date()): Promise<CloseResult> {
  if (!canClose(period, now).ok) return "not_ended";
  return db.transaction(async (tx) => {
    const c = await tx.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) });
    if (!c) return "not_found";
    const fx = await fxResolver(tx as unknown as Db, orgId, [period], now);
    if (!fx(c.billingCurrency, period)) return "no_rate";
    // Ensure a row exists, then lock it.
    await tx.insert(statements).values({ orgId, clientId, period, status: "draft" }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(statements)
      .where(and(eq(statements.clientId, clientId), eq(statements.period, period)))
      .for("update");
    if (!row || row.orgId !== orgId) return "not_found";
    if (row.status === "closed") return "already_closed";

    const usage = (await monthUsageLines(tx as unknown as Db, orgId, period, [clientId])).get(clientId) ?? [];
    const live = liveStatement(c, period, usage, fx, now);
    const frozen = freezeStatement(live, now, toStored(row, []));
    const s = frozen.snapshot!;
    const rate = s.fx!;
    await tx
      .update(statements)
      .set({
        status: "closed",
        clientName: c.name,
        billingMode: s.terms.billingMode,
        markupPct: String(s.terms.markupPct),
        monthlyFee: String(s.terms.fixedFee),
        currency: s.terms.currency,
        fxRate: String(rate.perUsd),
        fxDate: rate.date,
        fxSource: rate.source,
        requests: s.totals.requests,
        tokens: s.totals.tokens,
        costUsd: String(s.totals.costUsd),
        usageBilledUsd: String(s.totals.usageBilledUsd),
        fixedFeeUsd: String(s.totals.fixedFeeUsd),
        totalBilledUsd: String(s.totals.totalBilledUsd),
        usageBilled: String(s.totals.usageBilled),
        fixedFee: String(s.totals.fixedFee),
        totalBilled: String(s.totals.totalBilled),
        closedAt: frozen.closedAt,
      })
      .where(eq(statements.id, row.id));
    await tx.delete(statementLines).where(eq(statementLines.statementId, row.id));
    if (s.lines.length) {
      await tx.insert(statementLines).values(
        s.lines.map((l, i) => ({
          statementId: row.id,
          position: i,
          kind: l.kind,
          project: l.project,
          provider: l.provider,
          model: l.model,
          requests: l.requests,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          cacheReadTokens: l.cacheReadTokens,
          cacheWriteTokens: l.cacheWriteTokens,
          costUsd: String(l.costUsd),
          billedUsd: String(l.billedUsd),
          billed: String(l.billed),
        })),
      );
    }
    return "closed";
  });
}

/** Closes every draft statement of a month. Returns how many were closed and how many lack a rate. */
export async function closeAllDrafts(db: Db, orgId: string, period: string, now = new Date()) {
  if (!canClose(period, now).ok) return { closed: 0, noRate: 0 };
  const list = await listMonthStatements(db, orgId, period, now);
  let closed = 0;
  let noRate = 0;
  for (const s of list) {
    if (s.status !== "draft") continue;
    const r = await closeStatement(db, orgId, s.client.id, period, now);
    if (r === "closed") closed++;
    else if (r === "no_rate") noRate++;
  }
  return { closed, noRate };
}

export type ReopenResult = "reopened" | "not_closed";

/** Returns a closed statement to a live draft. The frozen lines, totals and rate are discarded. */
export async function reopenStatement(db: Db, orgId: string, clientId: string, period: string, now = new Date()): Promise<ReopenResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(statements)
      .where(and(eq(statements.orgId, orgId), eq(statements.clientId, clientId), eq(statements.period, period)))
      .for("update");
    if (!row || row.status !== "closed") return "not_closed";
    const next = reopenStored(toStored(row, []), now);
    await tx.delete(statementLines).where(eq(statementLines.statementId, row.id));
    await tx
      .update(statements)
      .set({
        status: next.status,
        closedAt: null,
        reopenedAt: next.reopenedAt,
        clientName: null,
        billingMode: null,
        markupPct: null,
        monthlyFee: null,
        currency: null,
        fxRate: null,
        fxDate: null,
        fxSource: null,
        requests: null,
        tokens: null,
        costUsd: null,
        usageBilledUsd: null,
        fixedFeeUsd: null,
        totalBilledUsd: null,
        usageBilled: null,
        fixedFee: null,
        totalBilled: null,
      })
      .where(eq(statements.id, row.id));
    return "reopened";
  });
}

/** Months (YYYY-MM, newest first) with a stored statement for a client, with status and frozen total. */
export async function clientStatementStatuses(db: Db, orgId: string, clientId: string) {
  const rows = await db
    .select({
      period: statements.period,
      status: statements.status,
      totalBilledUsd: statements.totalBilledUsd,
      totalBilled: statements.totalBilled,
      currency: statements.currency,
      closedAt: statements.closedAt,
    })
    .from(statements)
    .where(and(eq(statements.orgId, orgId), eq(statements.clientId, clientId)));
  return new Map(rows.map((r) => [r.period, r]));
}
