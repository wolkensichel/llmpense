import {
  aggregateLinesByProject,
  FIXED_FEE_LINE_LABEL,
  isIssued,
  minorUnits,
  type Currency,
  type FxRate,
  type StatementData,
  type StatementStatus,
} from "@llmpense/core";

/** What the accounting exports need from a statement. */
export interface StatementForExport {
  status: StatementStatus;
  client: { name: string; slug: string };
  data: StatementData;
  invoice: { number: string | null; issueDate: string | null; dueDate: string | null };
  /** Client-facing setting: name models on line descriptions. */
  showModelNames: boolean;
}

/** One invoice per statement, with the lines the client sees (amounts in the billing currency). */
export interface ExportInvoice {
  number: string;
  issueDate: string;
  dueDate: string;
  period: string;
  clientName: string;
  clientSlug: string;
  currency: Currency;
  fx: FxRate | null;
  lines: { description: string; amount: number }[];
  total: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" -> "Sep 2026" */
export function shortMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}

/**
 * Closed, sent and paid statements as invoices, in list order. Statements with nothing billed
 * (absorbed clients, months without usage) are left out, as are lines of zero (usage on a fixed
 * fee). Descriptions follow the client's model-name setting.
 */
export function toExportInvoices(list: readonly StatementForExport[]): ExportInvoice[] {
  const out: ExportInvoice[] = [];
  for (const s of list) {
    const { number, issueDate, dueDate } = s.invoice;
    const total = s.data.totals.totalBilled;
    if (!isIssued(s.status) || !number || !issueDate || !dueDate || total === null || total === 0) continue;
    const c = s.data.terms.currency;
    const lines = s.showModelNames ? s.data.lines : aggregateLinesByProject(s.data.lines, c);
    out.push({
      number,
      issueDate,
      dueDate,
      period: s.data.period,
      clientName: s.client.name,
      clientSlug: s.client.slug,
      currency: c,
      fx: s.data.fx,
      lines: lines
        .filter((l) => l.billed !== null && l.billed !== 0)
        .map((l) => ({
          description:
            l.kind === "fixed_fee"
              ? `${FIXED_FEE_LINE_LABEL}, ${shortMonth(s.data.period)}`
              : `AI usage ${shortMonth(s.data.period)}: ${l.project}${s.showModelNames && l.model ? ` (${l.model})` : ""}`,
          amount: l.billed!,
        })),
      total,
    });
  }
  return out;
}

/** An amount with the currency's decimals and a dot, e.g. "1234.50" or "12345" for JPY. */
export function decimalDot(n: number, c: Currency): string {
  return n.toFixed(minorUnits(c));
}

/** Result of building an export: the file, or what is missing. */
export type ExportResult = { ok: true; body: Uint8Array | string; filename: string; contentType: string; count: number } | { ok: false; error: string };
