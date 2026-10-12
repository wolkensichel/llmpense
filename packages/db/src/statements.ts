import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  buildStatement,
  cents,
  canClose,
  counterYear,
  dueDateFor,
  formatStatementNumber,
  freezeStatement,
  isCurrency,
  isIsoDay,
  isoDay,
  nextStatus,
  parsePeriod,
  paymentTermsFor,
  reopenStatement as reopenStored,
  resolveStatement,
  sourceKind,
  type Currency,
  type FxRate,
  type ModelNameDisplay,
  type ResolvedStatement,
  type StatementAction,
  type StatementData,
  type StatementLine,
  type StatementTerms,
  type StoredStatement,
  type UsageLine,
} from "@llmpense/core";
import type { Db } from "./client.ts";
import { fxResolver, type FxResolver } from "./fx.ts";
import { clients, orgs, projects, statementCounters, statementEvents, statementLines, statements, usageEvents } from "./schema.ts";

type ClientRow = typeof clients.$inferSelect;

/** Number, dates and lifecycle timestamps of a stored statement (all null for a never-closed draft). */
export interface InvoiceInfo {
  /** Kept when a statement is reopened, so a draft can have one too. */
  number: string | null;
  /** YYYY-MM-DD; null while a draft. */
  issueDate: string | null;
  dueDate: string | null;
  paymentTermsDays: number | null;
  sentAt: Date | null;
  paidAt: Date | null;
}

const NO_INVOICE: InvoiceInfo = { number: null, issueDate: null, dueDate: null, paymentTermsDays: null, sentAt: null, paidAt: null };

export interface ClientStatement extends ResolvedStatement {
  invoice: InvoiceInfo;
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
  if (row.status === "draft") return { status: "draft", closedAt: null, reopenedAt: row.reopenedAt, snapshot: null };
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
  return { status: row.status, closedAt: row.closedAt, reopenedAt: row.reopenedAt, snapshot };
}

async function loadStored(db: Db, orgId: string, period: string, clientIds?: string[]) {
  const rows = await db
    .select()
    .from(statements)
    .where(and(eq(statements.orgId, orgId), eq(statements.period, period), clientIds ? inArray(statements.clientId, clientIds) : undefined));
  const closedIds = rows.filter((r) => r.status !== "draft").map((r) => r.id);
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
  const name = r.status !== "draft" ? (stored?.row.clientName ?? c.name) : c.name;
  const row = stored?.row;
  const invoice: InvoiceInfo = row
    ? {
        number: row.number,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        paymentTermsDays: row.paymentTermsDays,
        sentAt: row.sentAt,
        paidAt: row.paidAt,
      }
    : { ...NO_INVOICE };
  return { ...r, invoice, client: { id: c.id, name, slug: c.slug, archived: c.archivedAt !== null, modelNames: c.modelNames } };
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
    if (row.status !== "draft") return "already_closed";
    const org = (await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) }))!;
    const issueDate = isoDay(now);
    const number = row.number ?? (await nextStatementNumber(tx as unknown as Db, orgId, org.statementNumberFormat, now.getUTCFullYear()));
    const termsDays = paymentTermsFor(org.paymentTermsDays, c.paymentTermsDays);

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
        number,
        issueDate,
        paymentTermsDays: termsDays,
        dueDate: dueDateFor(issueDate, termsDays),
        sentAt: null,
        paidAt: null,
      })
      .where(eq(statements.id, row.id));
    await logEvent(tx as unknown as Db, row.id, "close", "draft", "closed", now);
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
    await logEvent(tx as unknown as Db, row.id, "reopen", "closed", "draft", now);
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
        // The number stays with the statement; dates are set again when it is closed.
        issueDate: null,
        dueDate: null,
        paymentTermsDays: null,
        sentAt: null,
        paidAt: null,
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
      number: statements.number,
      dueDate: statements.dueDate,
    })
    .from(statements)
    .where(and(eq(statements.orgId, orgId), eq(statements.clientId, clientId)));
  return new Map(rows.map((r) => [r.period, r]));
}

// ---------------------------------------------------------------- numbering and lifecycle

async function logEvent(db: Db, statementId: string, action: StatementAction, from: StatementRow["status"], to: StatementRow["status"], at: Date) {
  await db.insert(statementEvents).values({ statementId, action, fromStatus: from, toStatus: to, at });
}

/**
 * The next statement number of an org. Must run inside the close transaction: the upsert locks the
 * counter row until the transaction ends, so concurrent closes queue up and get consecutive
 * numbers, and a rolled-back close gives its number back. A number that already exists (possible
 * after the format was changed back and forth) is skipped.
 */
export async function nextStatementNumber(tx: Db, orgId: string, format: string, year: number): Promise<string> {
  const scope = counterYear(format, year);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const [r] = await tx
      .insert(statementCounters)
      .values({ orgId, year: scope, lastValue: 1 })
      .onConflictDoUpdate({ target: [statementCounters.orgId, statementCounters.year], set: { lastValue: sql`${statementCounters.lastValue} + 1` } })
      .returning({ value: statementCounters.lastValue });
    const number = formatStatementNumber(format, year, r!.value);
    const [taken] = await tx
      .select({ id: statements.id })
      .from(statements)
      .where(and(eq(statements.orgId, orgId), eq(statements.number, number)))
      .limit(1);
    if (!taken) return number;
  }
  throw new Error("Could not find a free statement number");
}

export type MarkAction = Exclude<StatementAction, "close" | "reopen">;
export type MarkResult = "done" | "not_allowed" | "not_found" | "invalid_date";

/**
 * Moves a statement along closed -> sent -> paid, or one step back ("unmark"). Marking as sent can
 * set the issue date (default: keep the close date); the due date follows from the frozen payment
 * terms. The issue date can't be before the month has ended.
 */
export async function markStatement(
  db: Db,
  orgId: string,
  clientId: string,
  period: string,
  action: MarkAction,
  opts: { now?: Date; issueDate?: string | null } = {},
): Promise<MarkResult> {
  const now = opts.now ?? new Date();
  const p = mustPeriod(period);
  if (opts.issueDate != null && (!isIsoDay(opts.issueDate) || opts.issueDate < isoDay(p.end))) return "invalid_date";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(statements)
      .where(and(eq(statements.orgId, orgId), eq(statements.clientId, clientId), eq(statements.period, period)))
      .for("update");
    if (!row) return "not_found";
    const to = nextStatus(row.status, action);
    if (!to) return "not_allowed";
    const set: Partial<typeof statements.$inferInsert> = { status: to };
    if (action === "mark_sent") {
      set.sentAt = now;
      if (opts.issueDate && opts.issueDate !== row.issueDate) {
        const org = (await tx.query.orgs.findFirst({ where: eq(orgs.id, orgId) }))!;
        const terms = row.paymentTermsDays ?? org.paymentTermsDays;
        set.issueDate = opts.issueDate;
        set.paymentTermsDays = terms;
        set.dueDate = dueDateFor(opts.issueDate, terms);
      }
    } else if (action === "mark_paid") set.paidAt = now;
    else if (action === "unmark_sent") set.sentAt = null;
    else if (action === "unmark_paid") set.paidAt = null;
    await tx.update(statements).set(set).where(eq(statements.id, row.id));
    await logEvent(tx as unknown as Db, row.id, action, row.status, to, now);
    return "done";
  });
}

/** Applies a mark action to several clients' statements of one month; ones it doesn't apply to are skipped. */
export async function markStatements(
  db: Db,
  orgId: string,
  period: string,
  clientIds: readonly string[],
  action: MarkAction,
  opts: { now?: Date; issueDate?: string | null } = {},
) {
  let done = 0;
  let skipped = 0;
  for (const id of new Set(clientIds)) {
    const r = await markStatement(db, orgId, id, period, action, opts);
    if (r === "invalid_date") return { done, skipped, invalidDate: true };
    if (r === "done") done++;
    else skipped++;
  }
  return { done, skipped, invalidDate: false };
}

/** Lifecycle history of a client's statement for a month, oldest first. */
export async function statementHistory(db: Db, orgId: string, clientId: string, period: string) {
  return db
    .select({ action: statementEvents.action, fromStatus: statementEvents.fromStatus, toStatus: statementEvents.toStatus, at: statementEvents.at })
    .from(statementEvents)
    .innerJoin(statements, eq(statements.id, statementEvents.statementId))
    .where(and(eq(statements.orgId, orgId), eq(statements.clientId, clientId), eq(statements.period, period)))
    .orderBy(asc(statementEvents.at));
}
