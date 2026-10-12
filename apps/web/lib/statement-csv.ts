import { aggregateLinesByProject, minorUnits, rateNote, type Currency, type StatementData, type StatementStatus } from "@llmpense/core";
import { toCsv } from "./csv.ts";

export interface StatementForCsv {
  status: StatementStatus;
  client: { name: string; slug: string };
  data: StatementData;
  /** Statement number and dates; empty columns when absent (drafts). */
  invoice?: { number: string | null; issueDate: string | null; dueDate: string | null };
}

const invoiceCells = (s: StatementForCsv) => [s.invoice?.number ?? "", s.invoice?.issueDate ?? "", s.invoice?.dueDate ?? ""];

const money = (n: number) => n.toFixed(2);
const inCurrency = (n: number | null, c: Currency) => (n === null ? "" : n.toFixed(minorUnits(c)));

/**
 * The client-facing statement as CSV: one row per project and model (or per project when model
 * names are hidden), the fixed fee and a total, with amounts in the client's billing currency
 * only. Statements in another currency end with a row stating the exchange rate used.
 */
export function statementCsv(s: StatementForCsv, opts: { showModelNames?: boolean } = {}): string {
  const { period, totals, terms, fx } = s.data;
  const c = terms.currency;
  const lines = opts.showModelNames === false ? aggregateLinesByProject(s.data.lines, c) : s.data.lines;
  const header = [
    "period",
    "client",
    "status",
    "line_type",
    "project",
    "provider",
    "model",
    "requests",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "currency",
    "amount",
    "statement_number",
    "issue_date",
    "due_date",
  ];
  const inv = invoiceCells(s);
  const rows: (string | number)[][] = lines.map((l) => [
    period,
    s.client.name,
    s.status,
    l.kind,
    l.project,
    l.provider,
    l.model,
    l.requests,
    l.inputTokens,
    l.outputTokens,
    l.cacheReadTokens,
    l.cacheWriteTokens,
    c,
    inCurrency(l.billed, c),
    ...inv,
  ]);
  const sum = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens") => lines.reduce((a, l) => a + l[k], 0);
  rows.push([
    period,
    s.client.name,
    s.status,
    "total",
    "",
    "",
    "",
    totals.requests,
    sum("inputTokens"),
    sum("outputTokens"),
    sum("cacheReadTokens"),
    sum("cacheWriteTokens"),
    c,
    inCurrency(totals.totalBilled, c),
    ...inv,
  ]);
  const note = rateNote(fx);
  if (note) {
    const source = fx?.source === "ecb" ? ". Source: European Central Bank euro reference rates, USD cross rate via EUR" : "";
    rows.push([period, s.client.name, s.status, "exchange_rate", `${note}${source}`, "", "", "", "", "", "", "", c, "", ...inv]);
  }
  return toCsv([header, ...rows]);
}

/**
 * One row per client for a month, for bookkeeping. The `_usd` columns are USD (the fixed fee as
 * its USD equivalent); `total` is what the client is billed in its own currency, converted with
 * `fx_rate` (1 USD = fx_rate units) of `fx_date`.
 */
export function monthCsv(period: string, list: StatementForCsv[]): string {
  const header = [
    "period",
    "client",
    "client_slug",
    "billing_mode",
    "billed_usd",
    "fixed_fee_usd",
    "total_usd",
    "status",
    "currency",
    "total",
    "fx_rate",
    "fx_date",
    "fx_source",
    "statement_number",
    "issue_date",
    "due_date",
  ];
  const rows = list.map((s) => {
    const c = s.data.terms.currency;
    const fx = s.data.fx;
    return [
      period,
      s.client.name,
      s.client.slug,
      s.data.terms.billingMode,
      money(s.data.totals.usageBilledUsd),
      money(s.data.totals.fixedFeeUsd),
      money(s.data.totals.totalBilledUsd),
      s.status,
      c,
      inCurrency(s.data.totals.totalBilled, c),
      fx ? String(Number(fx.perUsd.toFixed(10))) : "",
      fx?.date ?? "",
      fx?.source ?? "",
      ...invoiceCells(s),
    ];
  });
  return toCsv([header, ...rows]);
}

/** Response headers for a CSV download. */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`,
      "cache-control": "no-store",
    },
  });
}
