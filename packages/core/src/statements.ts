import { proratedFixedFee, type BillingMode } from "./billing.ts";
import { roundUsd } from "./pricing.ts";

/**
 * Monthly statements: what one client is billed for one calendar month (UTC).
 *
 * A statement is a `draft` (computed live from usage events) until it is closed. Closing
 * freezes the terms, totals and line items; a closed statement never changes again unless it
 * is reopened, which returns it to a live draft.
 */
export const STATEMENT_STATUSES = ["draft", "closed"] as const;
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

export const STATEMENT_LINE_KINDS = ["usage", "fixed_fee"] as const;
export type StatementLineKind = (typeof STATEMENT_LINE_KINDS)[number];

export const FIXED_FEE_LINE_LABEL = "Fixed monthly fee";

// ---------------------------------------------------------------- periods

export interface StatementPeriod {
  /** `YYYY-MM` */
  period: string;
  /** First instant of the month, UTC. */
  start: Date;
  /** First instant of the next month, UTC (exclusive). */
  end: Date;
}

/** `YYYY-MM` -> the UTC calendar month, or null if malformed. */
export function parsePeriod(v: string | null | undefined): StatementPeriod | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(v ?? "");
  if (!m) return null;
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return { period: v!, start, end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)) };
}

/** The `YYYY-MM` period containing `d` (UTC). */
export function periodOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** Moves a `YYYY-MM` period by `months` (negative goes back). */
export function shiftPeriod(period: string, months: number): string {
  const p = parsePeriod(period);
  if (!p) throw new Error(`Invalid period: ${period}`);
  return periodOf(new Date(Date.UTC(p.start.getUTCFullYear(), p.start.getUTCMonth() + months, 1)));
}

// ---------------------------------------------------------------- building

/** Billing terms a statement is computed with (the client's settings, or the frozen copy). */
export interface StatementTerms {
  billingMode: BillingMode;
  markupPct: number;
  /** Monthly fee for billing mode `fixed`. */
  fixedFeeUsd: number;
}

/** Aggregated usage for one project and model in the month. */
export interface UsageLine {
  project: string;
  provider: string;
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Provider cost, full precision. */
  costUsd: number;
  /** Sum of per-event billed amounts (frozen at ingest), full precision. */
  billedUsd: number;
}

export interface StatementLine extends UsageLine {
  kind: StatementLineKind;
}

export interface StatementTotals {
  requests: number;
  tokens: number;
  /** Provider cost (8 decimals). */
  costUsd: number;
  /** Billed for usage, the sum of the cent-rounded usage lines. */
  usageBilledUsd: number;
  /** Fixed fee for the month (or the part of it earned so far), in cents. */
  fixedFeeUsd: number;
  /** What the client pays: usage billed + fixed fee. */
  totalBilledUsd: number;
  marginUsd: number;
  /** Margin over the billed total; null when nothing is billed. */
  marginPct: number | null;
}

/**
 * How much of the month the fixed fee covers:
 * - full:    the month has ended, the whole fee is billed
 * - to_date: the month is in progress, the fee is prorated up to `asOf`
 * - none:    the month has not started, or the client is not on a fixed fee
 */
export type FeeCoverage = "full" | "to_date" | "none";

export interface StatementData {
  period: string;
  terms: StatementTerms;
  /** Usage lines sorted by project, provider, model; the fixed-fee line (if any) comes last. */
  lines: StatementLine[];
  totals: StatementTotals;
  feeCoverage: FeeCoverage;
}

/** Rounds to whole cents (half away from zero). */
export function cents(n: number): number {
  const r = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100;
  return n < 0 && r !== 0 ? -r : r;
}

const usageTokens = (l: UsageLine) => l.inputTokens + l.outputTokens + l.cacheReadTokens + l.cacheWriteTokens;

/**
 * Fixed fee billed on a statement. Months that have ended bill the whole fee; the running
 * month bills the part earned up to `asOf`, prorated by time with the same rule the dashboards use.
 */
export function statementFixedFee(terms: StatementTerms, period: StatementPeriod, asOf: Date): { feeUsd: number; coverage: FeeCoverage } {
  if (terms.billingMode !== "fixed" || !(terms.fixedFeeUsd > 0) || asOf <= period.start) return { feeUsd: 0, coverage: "none" };
  const until = asOf < period.end ? asOf : period.end;
  return {
    feeUsd: cents(proratedFixedFee(terms.fixedFeeUsd, period.start, until)),
    coverage: asOf >= period.end ? "full" : "to_date",
  };
}

/** Computes a statement from aggregated usage. Pure: same inputs, same statement. */
export function buildStatement(input: { period: string; terms: StatementTerms; usage: UsageLine[]; asOf: Date }): StatementData {
  const period = parsePeriod(input.period);
  if (!period) throw new Error(`Invalid period: ${input.period}`);

  const usage: StatementLine[] = input.usage
    .filter((l) => l.requests > 0 || l.costUsd !== 0 || l.billedUsd !== 0)
    .map((l) => ({ ...l, kind: "usage" as const, costUsd: roundUsd(l.costUsd), billedUsd: cents(l.billedUsd) }))
    .sort((a, b) => a.project.localeCompare(b.project) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

  const fee = statementFixedFee(input.terms, period, input.asOf);
  const lines = [...usage];
  if (fee.coverage !== "none") {
    lines.push({
      kind: "fixed_fee",
      project: FIXED_FEE_LINE_LABEL,
      provider: "",
      model: "",
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      billedUsd: fee.feeUsd,
    });
  }

  const costUsd = roundUsd(usage.reduce((a, l) => a + l.costUsd, 0));
  const usageBilledUsd = cents(usage.reduce((a, l) => a + l.billedUsd, 0));
  const totalBilledUsd = cents(usageBilledUsd + fee.feeUsd);
  // The margin is reported in cents, like the billed amounts, so sub-cent rounding is not a loss.
  const marginUsd = cents(totalBilledUsd - costUsd);
  return {
    period: period.period,
    terms: { ...input.terms },
    lines,
    totals: {
      requests: usage.reduce((a, l) => a + l.requests, 0),
      tokens: usage.reduce((a, l) => a + usageTokens(l), 0),
      costUsd,
      usageBilledUsd,
      fixedFeeUsd: fee.feeUsd,
      totalBilledUsd,
      marginUsd,
      marginPct: totalBilledUsd > 0 ? marginUsd / totalBilledUsd : null,
    },
    feeCoverage: fee.coverage,
  };
}

// ---------------------------------------------------------------- closing and reopening

/** What is stored for a client and month. No record means a never-closed draft. */
export interface StoredStatement {
  status: StatementStatus;
  closedAt: Date | null;
  reopenedAt: Date | null;
  /** The frozen statement; present only while closed. */
  snapshot: StatementData | null;
}

export interface ResolvedStatement {
  status: StatementStatus;
  closedAt: Date | null;
  reopenedAt: Date | null;
  data: StatementData;
}

/** A month can be closed once it has ended. */
export function canClose(period: string, now: Date): { ok: true } | { ok: false; reason: string } {
  const p = parsePeriod(period);
  if (!p) return { ok: false, reason: "Invalid month." };
  if (now < p.end) return { ok: false, reason: "This month has not ended yet." };
  return { ok: true };
}

/** Freezes a live statement. The snapshot is a deep copy, so later changes to the input never reach it. */
export function freezeStatement(live: StatementData, closedAt: Date, previous?: StoredStatement | null): StoredStatement {
  if (previous?.status === "closed") throw new Error("Statement is already closed");
  return { status: "closed", closedAt, reopenedAt: previous?.reopenedAt ?? null, snapshot: structuredClone(live) };
}

/** Reopens a closed statement: the snapshot is dropped and the month is computed live again. */
export function reopenStatement(stored: StoredStatement, at: Date): StoredStatement {
  if (stored.status !== "closed") throw new Error("Only a closed statement can be reopened");
  return { status: "draft", closedAt: null, reopenedAt: at, snapshot: null };
}

/** A closed statement shows its snapshot; anything else is computed live. */
export function resolveStatement(stored: StoredStatement | null | undefined, live: () => StatementData): ResolvedStatement {
  if (stored?.status === "closed" && stored.snapshot) {
    return { status: "closed", closedAt: stored.closedAt, reopenedAt: stored.reopenedAt, data: stored.snapshot };
  }
  return { status: "draft", closedAt: null, reopenedAt: stored?.reopenedAt ?? null, data: live() };
}

// ---------------------------------------------------------------- fixed-fee loss

export interface FixedFeeLoss {
  costUsd: number;
  /** Fee earned from the start of the month up to `asOf`. */
  feeToDateUsd: number;
  overByUsd: number;
}

/**
 * A fixed-fee client is unprofitable for a month so far when its month-to-date provider cost
 * exceeds the part of its monthly fee earned up to `asOf` (prorated by time, clamped to the
 * month). Returns null when it is not.
 */
export function fixedFeeLoss(input: { terms: StatementTerms; period: string; costToDateUsd: number; asOf: Date }): FixedFeeLoss | null {
  if (input.terms.billingMode !== "fixed") return null;
  const p = parsePeriod(input.period);
  if (!p) throw new Error(`Invalid period: ${input.period}`);
  const until = input.asOf < p.end ? input.asOf : p.end;
  const feeToDateUsd = proratedFixedFee(input.terms.fixedFeeUsd, p.start, until);
  const costUsd = roundUsd(input.costToDateUsd);
  if (!(costUsd > 0) || costUsd <= feeToDateUsd) return null;
  return { costUsd, feeToDateUsd, overByUsd: roundUsd(costUsd - feeToDateUsd) };
}
