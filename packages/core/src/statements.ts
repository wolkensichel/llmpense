import { proratedFixedFee, proratedFixedFeeUsd, type BillingMode } from "./billing.ts";
import { fromUsd, roundMinor, toUsd, USD_RATE, type Currency, type FxRate } from "./fx.ts";
import { roundUsd } from "./pricing.ts";

/**
 * Monthly statements: what one client is billed for one calendar month (UTC).
 *
 * A statement is a `draft` (computed live from usage events) until it is closed. Closing
 * freezes the terms, the exchange rate, totals and line items; a closed statement never changes
 * again unless it is reopened, which returns it to a live draft.
 *
 * Amounts: provider cost and the per-event billed amounts are USD. A client billed in another
 * currency gets each line converted with the month's rate and rounded to the currency's minor
 * unit; the statement total is the sum of the rounded lines. The fixed fee is set in the billing
 * currency and converted to USD for margins.
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

/** Every `YYYY-MM` period that [start, end) touches. */
export function periodsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  if (end <= start) return out;
  for (let p = periodOf(start); ; p = shiftPeriod(p, 1)) {
    if (parsePeriod(p)!.start >= end) break;
    out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------- building

/** Billing terms a statement is computed with (the client's settings, or the frozen copy). */
export interface StatementTerms {
  billingMode: BillingMode;
  markupPct: number;
  /** Monthly fee for billing mode `fixed`, in the billing currency. */
  fixedFee: number;
  /** Currency the client is billed in. */
  currency: Currency;
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
  /**
   * Billed in the billing currency, rounded to its minor unit. `billedUsd` holds the USD amount
   * (usage) or the USD equivalent (fixed fee). Null when no exchange rate is available.
   */
  billed: number | null;
}

export interface StatementTotals {
  requests: number;
  tokens: number;
  /** Provider cost (8 decimals). */
  costUsd: number;
  /** Billed for usage, the sum of the cent-rounded usage lines. */
  usageBilledUsd: number;
  /** USD equivalent of the fixed fee for the month (or the part earned so far), in cents. */
  fixedFeeUsd: number;
  /** What the client pays, in USD: usage billed + fixed fee equivalent. */
  totalBilledUsd: number;
  marginUsd: number;
  /** Margin over the billed total; null when nothing is billed. */
  marginPct: number | null;
  /** Billed for usage in the billing currency (sum of rounded lines); null without a rate. */
  usageBilled: number | null;
  /** Fixed fee in the billing currency. */
  fixedFee: number;
  /** What the client pays in the billing currency; null without a rate. */
  totalBilled: number | null;
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
  /** The rate USD amounts were converted with; null when the currency has no rate for the month. */
  fx: FxRate | null;
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
 * Fixed fee billed on a statement, in the billing currency. Months that have ended bill the
 * whole fee; the running month bills the part earned up to `asOf`, prorated by time with the
 * same rule the dashboards use.
 */
export function statementFixedFee(terms: StatementTerms, period: StatementPeriod, asOf: Date): { fee: number; coverage: FeeCoverage } {
  if (terms.billingMode !== "fixed" || !(terms.fixedFee > 0) || asOf <= period.start) return { fee: 0, coverage: "none" };
  const until = asOf < period.end ? asOf : period.end;
  return {
    fee: roundMinor(proratedFixedFee(terms.fixedFee, period.start, until), terms.currency),
    coverage: asOf >= period.end ? "full" : "to_date",
  };
}

/** The rate to use for `currency`: USD needs none; any other currency needs a matching rate. */
export function usableRate(currency: Currency, fx: FxRate | null | undefined): FxRate | null {
  if (currency === "USD") return USD_RATE;
  return fx && fx.currency === currency && fx.perUsd > 0 ? fx : null;
}

/** Computes a statement from aggregated usage. Pure: same inputs, same statement. */
export function buildStatement(input: { period: string; terms: StatementTerms; usage: UsageLine[]; asOf: Date; fx?: FxRate | null }): StatementData {
  const period = parsePeriod(input.period);
  if (!period) throw new Error(`Invalid period: ${input.period}`);
  const currency = input.terms.currency;
  const fx = usableRate(currency, input.fx);

  const usage: StatementLine[] = input.usage
    .filter((l) => l.requests > 0 || l.costUsd !== 0 || l.billedUsd !== 0)
    .map((l) => ({
      ...l,
      kind: "usage" as const,
      costUsd: roundUsd(l.costUsd),
      billedUsd: cents(l.billedUsd),
      // Convert the line's full-precision USD amount, then round once to the minor unit.
      billed: fx ? fromUsd(l.billedUsd, fx) : null,
    }))
    .sort((a, b) => a.project.localeCompare(b.project) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

  const fee = statementFixedFee(input.terms, period, input.asOf);
  const feeUsd = fx ? cents(toUsd(fee.fee, fx)) : 0;
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
      billedUsd: feeUsd,
      billed: fee.fee,
    });
  }

  const costUsd = roundUsd(usage.reduce((a, l) => a + l.costUsd, 0));
  const usageBilledUsd = cents(usage.reduce((a, l) => a + l.billedUsd, 0));
  const totalBilledUsd = cents(usageBilledUsd + feeUsd);
  const usageBilled = fx ? roundMinor(usage.reduce((a, l) => a + (l.billed ?? 0), 0), currency) : null;
  // The margin is reported in cents, like the billed amounts, so sub-cent rounding is not a loss.
  const marginUsd = cents(totalBilledUsd - costUsd);
  return {
    period: period.period,
    terms: { ...input.terms },
    fx: fx ? { ...fx } : null,
    lines,
    totals: {
      requests: usage.reduce((a, l) => a + l.requests, 0),
      tokens: usage.reduce((a, l) => a + usageTokens(l), 0),
      costUsd,
      usageBilledUsd,
      fixedFeeUsd: feeUsd,
      totalBilledUsd,
      marginUsd,
      marginPct: totalBilledUsd > 0 ? marginUsd / totalBilledUsd : null,
      usageBilled,
      fixedFee: fee.fee,
      totalBilled: usageBilled === null ? null : roundMinor(usageBilled + fee.fee, currency),
    },
    feeCoverage: fee.coverage,
  };
}

// ---------------------------------------------------------------- model names on client statements

/** Per-client setting: null follows the org default. */
export const MODEL_NAME_DISPLAY = ["show", "hide"] as const;
export type ModelNameDisplay = (typeof MODEL_NAME_DISPLAY)[number];

/** Whether client-facing statements name models: the client's override, else the org default. */
export function showModelNames(orgDefault: boolean, clientSetting: ModelNameDisplay | null | undefined): boolean {
  return clientSetting === "show" ? true : clientSetting === "hide" ? false : orgDefault;
}

/**
 * Merges usage lines per project, for client-facing statements that hide model names.
 * Requests, tokens and amounts are summed; billed amounts are sums of the already-rounded line
 * amounts, so the statement totals do not change. The fixed-fee line is kept as it is, last.
 */
export function aggregateLinesByProject(lines: readonly StatementLine[], currency: Currency): StatementLine[] {
  const byProject = new Map<string, StatementLine>();
  const rest: StatementLine[] = [];
  for (const l of lines) {
    if (l.kind !== "usage") {
      rest.push({ ...l });
      continue;
    }
    const a = byProject.get(l.project);
    if (!a) {
      byProject.set(l.project, { ...l, provider: "", model: "" });
      continue;
    }
    a.requests += l.requests;
    a.inputTokens += l.inputTokens;
    a.outputTokens += l.outputTokens;
    a.cacheReadTokens += l.cacheReadTokens;
    a.cacheWriteTokens += l.cacheWriteTokens;
    a.costUsd = roundUsd(a.costUsd + l.costUsd);
    a.billedUsd = cents(a.billedUsd + l.billedUsd);
    a.billed = a.billed === null || l.billed === null ? null : roundMinor(a.billed + l.billed, currency);
  }
  return [...byProject.values(), ...rest];
}

// ---------------------------------------------------------------- closing and reopening

/** What is stored for a client and month. No record means a never-closed draft. */
export interface StoredStatement {
  status: StatementStatus;
  closedAt: Date | null;
  reopenedAt: Date | null;
  /** The frozen statement, including its exchange rate; present only while closed. */
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

/**
 * Freezes a live statement. The snapshot is a deep copy (terms, rate, totals and lines), so later
 * changes to the input or to stored rates never reach it. A statement in a currency without a
 * rate cannot be frozen.
 */
export function freezeStatement(live: StatementData, closedAt: Date, previous?: StoredStatement | null): StoredStatement {
  if (previous?.status === "closed") throw new Error("Statement is already closed");
  if (!live.fx) throw new Error(`No exchange rate for ${live.terms.currency} in ${live.period}`);
  return { status: "closed", closedAt, reopenedAt: previous?.reopenedAt ?? null, snapshot: structuredClone(live) };
}

/** Reopens a closed statement: the snapshot and its rate are dropped and the month is computed live again. */
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
  /** Fee earned from the start of the month up to `asOf`, in USD. */
  feeToDateUsd: number;
  overByUsd: number;
}

/**
 * A fixed-fee client is unprofitable for a month so far when its month-to-date provider cost
 * exceeds the part of its monthly fee earned up to `asOf` (prorated by time, clamped to the
 * month, converted to USD with the month's rate). Returns null when it is not, or when a fee in
 * another currency has no rate to compare with.
 */
export function fixedFeeLoss(input: {
  terms: StatementTerms;
  period: string;
  costToDateUsd: number;
  asOf: Date;
  fx?: FxRate | null;
}): FixedFeeLoss | null {
  if (input.terms.billingMode !== "fixed") return null;
  const p = parsePeriod(input.period);
  if (!p) throw new Error(`Invalid period: ${input.period}`);
  const fx = usableRate(input.terms.currency, input.fx);
  if (!fx) return null;
  const until = input.asOf < p.end ? input.asOf : p.end;
  const feeToDateUsd = proratedFixedFeeUsd(input.terms.fixedFee, p.start, until, () => 1 / fx.perUsd);
  const costUsd = roundUsd(input.costToDateUsd);
  if (!(costUsd > 0) || costUsd <= feeToDateUsd) return null;
  return { costUsd, feeToDateUsd, overByUsd: roundUsd(costUsd - feeToDateUsd) };
}
