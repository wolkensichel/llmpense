import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  buildStatement,
  cents,
  canClose,
  freezeStatement,
  parsePeriod,
  reopenStatement as reopenStored,
  resolveStatement,
  type ResolvedStatement,
  type StatementData,
  type StatementLine,
  type StatementTerms,
  type StoredStatement,
  type UsageLine,
} from "@llmpense/core";
import type { Db } from "./client.ts";
import { clients, projects, statementLines, statements, usageEvents } from "./schema.ts";

type ClientRow = typeof clients.$inferSelect;

export interface ClientStatement extends ResolvedStatement {
  client: { id: string; name: string; slug: string; archived: boolean };
}

const n = (v: unknown) => Number(v ?? 0);

function termsOf(c: ClientRow): StatementTerms {
  return { billingMode: c.billingMode, markupPct: n(c.markupPct), fixedFeeUsd: n(c.fixedFeeUsd) };
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

/** Rebuilds the frozen StatementData from stored columns and lines. */
function toStored(row: StatementRow, lines: LineRow[]): StoredStatement {
  if (row.status !== "closed") return { status: "draft", closedAt: null, reopenedAt: row.reopenedAt, snapshot: null };
  const fixedFeeUsd = n(row.fixedFeeUsd);
  const totalBilledUsd = n(row.totalBilledUsd);
  const costUsd = n(row.costUsd);
  const marginUsd = cents(totalBilledUsd - costUsd);
  const snapshot: StatementData = {
    period: row.period,
    terms: { billingMode: row.billingMode ?? "markup", markupPct: n(row.markupPct), fixedFeeUsd: n(row.monthlyFeeUsd) },
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

function resolveFor(c: ClientRow, period: string, usage: UsageLine[], stored: { row: StatementRow; stored: StoredStatement } | undefined, now: Date): ClientStatement {
  const r = resolveStatement(stored?.stored, () => buildStatement({ period, terms: termsOf(c), usage, asOf: now }));
  const name = r.status === "closed" ? (stored?.row.clientName ?? c.name) : c.name;
  return { ...r, client: { id: c.id, name, slug: c.slug, archived: c.archivedAt !== null } };
}

/** One client's statement for a month: the frozen snapshot if closed, otherwise computed live. */
export async function getClientStatement(db: Db, orgId: string, clientId: string, period: string, now = new Date()) {
  mustPeriod(period);
  const c = await db.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) });
  if (!c) return null;
  const [usage, stored] = await Promise.all([monthUsageLines(db, orgId, period, [c.id]), loadStored(db, orgId, period, [c.id])]);
  return resolveFor(c, period, usage.get(c.id) ?? [], stored.get(c.id), now);
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
  const usage = await monthUsageLines(db, orgId, period);
  return list.map((c) => resolveFor(c, period, usage.get(c.id) ?? [], stored.get(c.id), now));
}

export type CloseResult = "closed" | "already_closed" | "not_ended" | "not_found";

/**
 * Freezes a client's statement for a month. Runs in a transaction and takes a row lock, so two
 * concurrent closes cannot both snapshot. A closed statement is never re-snapshotted.
 */
export async function closeStatement(db: Db, orgId: string, clientId: string, period: string, now = new Date()): Promise<CloseResult> {
  if (!canClose(period, now).ok) return "not_ended";
  return db.transaction(async (tx) => {
    const c = await tx.query.clients.findFirst({ where: and(eq(clients.id, clientId), eq(clients.orgId, orgId)) });
    if (!c) return "not_found";
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
    const live = buildStatement({ period, terms: termsOf(c), usage, asOf: now });
    const frozen = freezeStatement(live, now, toStored(row, []));
    const s = frozen.snapshot!;
    await tx
      .update(statements)
      .set({
        status: "closed",
        clientName: c.name,
        billingMode: s.terms.billingMode,
        markupPct: String(s.terms.markupPct),
        monthlyFeeUsd: String(s.terms.fixedFeeUsd),
        requests: s.totals.requests,
        tokens: s.totals.tokens,
        costUsd: String(s.totals.costUsd),
        usageBilledUsd: String(s.totals.usageBilledUsd),
        fixedFeeUsd: String(s.totals.fixedFeeUsd),
        totalBilledUsd: String(s.totals.totalBilledUsd),
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
        })),
      );
    }
    return "closed";
  });
}

/** Closes every draft statement of a month. Returns how many were closed. */
export async function closeAllDrafts(db: Db, orgId: string, period: string, now = new Date()) {
  if (!canClose(period, now).ok) return 0;
  const list = await listMonthStatements(db, orgId, period, now);
  let closed = 0;
  for (const s of list) {
    if (s.status !== "draft") continue;
    if ((await closeStatement(db, orgId, s.client.id, period, now)) === "closed") closed++;
  }
  return closed;
}

export type ReopenResult = "reopened" | "not_closed";

/** Returns a closed statement to a live draft. The frozen lines and totals are discarded. */
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
        monthlyFeeUsd: null,
        requests: null,
        tokens: null,
        costUsd: null,
        usageBilledUsd: null,
        fixedFeeUsd: null,
        totalBilledUsd: null,
      })
      .where(eq(statements.id, row.id));
    return "reopened";
  });
}

/** Months (YYYY-MM, newest first) with a stored statement for a client, with status. */
export async function clientStatementStatuses(db: Db, orgId: string, clientId: string) {
  const rows = await db
    .select({ period: statements.period, status: statements.status, totalBilledUsd: statements.totalBilledUsd, closedAt: statements.closedAt })
    .from(statements)
    .where(and(eq(statements.orgId, orgId), eq(statements.clientId, clientId)));
  return new Map(rows.map((r) => [r.period, r]));
}
