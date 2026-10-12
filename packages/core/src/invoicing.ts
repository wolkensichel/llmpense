import type { StatementStatus } from "./statements.ts";

/**
 * Statement lifecycle, numbering and payment terms.
 *
 *   draft ──close──► closed ──mark_sent──► sent ──mark_paid──► paid
 *     ▲                │  ▲                 │  ▲                 │
 *     └────reopen──────┘  └───unmark_sent───┘  └───unmark_paid───┘
 *
 * Only a closed statement can be reopened; a sent or paid statement has to be unmarked step by
 * step first. Every status except draft keeps the frozen snapshot. A statement keeps the number it
 * got when it was closed for the first time, also across reopening.
 */
export const STATEMENT_ACTIONS = ["close", "reopen", "mark_sent", "mark_paid", "unmark_sent", "unmark_paid"] as const;
export type StatementAction = (typeof STATEMENT_ACTIONS)[number];

export const TRANSITIONS: Record<StatementAction, { from: StatementStatus; to: StatementStatus }> = {
  close: { from: "draft", to: "closed" },
  reopen: { from: "closed", to: "draft" },
  mark_sent: { from: "closed", to: "sent" },
  mark_paid: { from: "sent", to: "paid" },
  unmark_sent: { from: "sent", to: "closed" },
  unmark_paid: { from: "paid", to: "sent" },
};

export function isStatementAction(v: unknown): v is StatementAction {
  return typeof v === "string" && (STATEMENT_ACTIONS as readonly string[]).includes(v);
}

/** The status after `action`, or null when the action is not allowed from `from`. */
export function nextStatus(from: StatementStatus, action: StatementAction): StatementStatus | null {
  const t = TRANSITIONS[action];
  return t.from === from ? t.to : null;
}

/** Actions allowed from a status, in the order the UI offers them. */
export function allowedActions(status: StatementStatus): StatementAction[] {
  return STATEMENT_ACTIONS.filter((a) => TRANSITIONS[a].from === status);
}

/** Every status but draft shows the frozen snapshot. */
export function isFrozen(status: StatementStatus): boolean {
  return status !== "draft";
}

/** Closed, sent and paid statements are invoices for accounting exports. */
export function isIssued(status: StatementStatus): boolean {
  return status === "closed" || status === "sent" || status === "paid";
}

// ---------------------------------------------------------------- numbers

export const DEFAULT_NUMBER_FORMAT = "ST-{YYYY}-{NNNN}";
/** Longest number the format may produce: DATEV "Belegfeld 1" holds 36 characters. */
export const MAX_NUMBER_LENGTH = 36;

const TOKEN = /\{(YYYY|YY|N{1,8})\}/g;

/**
 * Checks a statement number format. It needs exactly one counter token `{N…}` (1 to 8 Ns, the
 * width it is zero-padded to) and may contain `{YYYY}` or `{YY}`. Literal text is limited to
 * letters, digits, `-`, `_` and `/`, the characters accounting imports accept in invoice numbers.
 */
export function validateNumberFormat(format: string): { ok: true } | { ok: false; reason: string } {
  const f = format.trim();
  if (!f) return { ok: false, reason: "Enter a number format, e.g. ST-{YYYY}-{NNNN}." };
  const counters = f.match(/\{N+\}/g) ?? [];
  if (counters.length !== 1) return { ok: false, reason: "The format needs exactly one counter, e.g. {NNNN}." };
  if (counters[0]!.length - 2 > 8) return { ok: false, reason: "The counter can have at most 8 digits ({NNNNNNNN})." };
  const literal = f.replace(TOKEN, "");
  if (/[{}]/.test(literal)) return { ok: false, reason: "Unknown placeholder. Use {YYYY}, {YY} and one counter like {NNNN}." };
  if (!/^[A-Za-z0-9_\-/]*$/.test(literal)) return { ok: false, reason: "Use only letters, digits, - _ and / besides the placeholders." };
  if (formatStatementNumber(f, 2026, 99_999_999).length > MAX_NUMBER_LENGTH) {
    return { ok: false, reason: `Numbers can be at most ${MAX_NUMBER_LENGTH} characters long.` };
  }
  return { ok: true };
}

/** Whether the counter restarts every year: formats with a year token count per year. */
export function countsPerYear(format: string): boolean {
  return /\{(YYYY|YY)\}/.test(format);
}

/** The counter scope for a number issued in `year`: the year, or 0 for one running counter. */
export function counterYear(format: string, year: number): number {
  return countsPerYear(format) ? year : 0;
}

/** `ST-{YYYY}-{NNNN}`, 2026, 7 -> `ST-2026-0007`. Counters wider than the padding are not cut. */
export function formatStatementNumber(format: string, year: number, counter: number): string {
  return format.trim().replace(TOKEN, (_, t: string) => {
    if (t === "YYYY") return String(year).padStart(4, "0");
    if (t === "YY") return String(year % 100).padStart(2, "0");
    return String(counter).padStart(t.length, "0");
  });
}

// ---------------------------------------------------------------- dates and payment terms

export const DEFAULT_PAYMENT_TERMS_DAYS = 14;
export const MAX_PAYMENT_TERMS_DAYS = 365;

/** The client's payment terms if set, else the org's. */
export function paymentTermsFor(orgDays: number, clientDays: number | null | undefined): number {
  return clientDays === null || clientDays === undefined ? orgDays : clientDays;
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD of a UTC date. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === v;
}

/** YYYY-MM-DD plus `days` calendar days. */
export function addDays(day: string, days: number): string {
  if (!isIsoDay(day)) throw new Error(`Invalid date: ${day}`);
  return isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/** Due date: issue date + payment terms in days. */
export function dueDateFor(issueDate: string, termsDays: number): string {
  return addDays(issueDate, termsDays);
}

/** A sent statement is overdue from the day after its due date (UTC). Paid ones never are. */
export function isOverdue(status: StatementStatus, dueDate: string | null | undefined, today: string): boolean {
  return status === "sent" && !!dueDate && today > dueDate;
}

/** Whole days past the due date (0 when not overdue). */
export function daysOverdue(status: StatementStatus, dueDate: string | null | undefined, today: string): number {
  if (!isOverdue(status, dueDate, today)) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS);
}

/**
 * File name for a statement download: `ST-2026-0001-acme-retail-2026-09.pdf`, or without the
 * number for a draft. Only safe characters survive.
 */
export function statementFileName(opts: { number: string | null; clientSlug: string; period: string; ext: string }): string {
  const base = [opts.number, opts.clientSlug, opts.period].filter(Boolean).join("-");
  return `${base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}.${opts.ext}`;
}
