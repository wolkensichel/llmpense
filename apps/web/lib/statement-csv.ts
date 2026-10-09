import { type StatementData, type StatementStatus } from "@llmpense/core";
import { toCsv } from "./csv.ts";

export interface StatementForCsv {
  status: StatementStatus;
  client: { name: string; slug: string };
  data: StatementData;
}

const money = (n: number) => n.toFixed(2);
const fine = (n: number) => n.toFixed(6);

/** Line items of one statement: one row per project and model, the fixed fee, and a total row. */
export function statementCsv(s: StatementForCsv): string {
  const { period, lines, totals } = s.data;
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
    "cost_usd",
    "billed_usd",
  ];
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
    fine(l.costUsd),
    money(l.billedUsd),
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
    fine(totals.costUsd),
    money(totals.totalBilledUsd),
  ]);
  return toCsv([header, ...rows]);
}

/** One row per client for a month, for bookkeeping. */
export function monthCsv(period: string, list: StatementForCsv[]): string {
  const header = ["period", "client", "client_slug", "billing_mode", "billed_usd", "fixed_fee_usd", "total_usd", "status"];
  const rows = list.map((s) => [
    period,
    s.client.name,
    s.client.slug,
    s.data.terms.billingMode,
    money(s.data.totals.usageBilledUsd),
    money(s.data.totals.fixedFeeUsd),
    money(s.data.totals.totalBilledUsd),
    s.status,
  ]);
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
