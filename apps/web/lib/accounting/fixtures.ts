import { buildStatement, type FxRate, type StatementTerms, type UsageLine } from "@llmpense/core";
import type { StatementForExport } from "./common.ts";

/** Fixed statements for the export golden files: EUR, USD (models hidden), JPY fixed fee, plus two that are left out. */
const AS_OF = new Date("2026-10-02T09:00:00Z");
const PERIOD = "2026-09";

const usage = (project: string, model: string, billedUsd: number, costUsd = billedUsd / 1.3): UsageLine => ({
  project,
  provider: "openai",
  model,
  requests: 100,
  inputTokens: 100_000,
  outputTokens: 10_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd,
  billedUsd,
});

const rate = (currency: FxRate["currency"], perUsd: number): FxRate => ({ currency, perUsd, date: "2026-09-30", source: "ecb" });

function statement(
  name: string,
  slug: string,
  terms: StatementTerms,
  lines: UsageLine[],
  fx: FxRate | null,
  invoice: StatementForExport["invoice"],
  opts: { status?: StatementForExport["status"]; showModelNames?: boolean } = {},
): StatementForExport {
  return {
    status: opts.status ?? "sent",
    client: { name, slug },
    data: buildStatement({ period: PERIOD, terms, usage: lines, asOf: AS_OF, fx }),
    invoice,
    showModelNames: opts.showModelNames ?? true,
  };
}

/** EUR per USD in September 2026 for the fixtures. */
export const FIXTURE_EUR_PER_USD = 0.8584;

export const FIXTURE_STATEMENTS: StatementForExport[] = [
  statement(
    "Müller & Söhne GmbH",
    "mueller",
    { billingMode: "markup", markupPct: 30, fixedFee: 0, currency: "EUR" },
    [usage("Support bot", "gpt-5-mini", 123.456), usage("Support bot", "gpt-5", 40.1), usage("Suche \"Pro\"", "gpt-5-mini", 9.99)],
    rate("EUR", FIXTURE_EUR_PER_USD),
    { number: "ST-2026-0001", issueDate: "2026-10-02", dueDate: "2026-10-16" },
  ),
  statement(
    "Acme Retail",
    "acme-retail",
    { billingMode: "markup", markupPct: 30, fixedFee: 0, currency: "USD" },
    [usage("Product search", "gemini-2.5-pro", 1200.5), usage("Product search", "gpt-5-mini", 34.25), usage("Support bot", "gpt-5", 1.005)],
    null,
    { number: "ST-2026-0002", issueDate: "2026-10-02", dueDate: "2026-10-16" },
    { status: "paid", showModelNames: false },
  ),
  statement(
    "Tanaka KK",
    "tanaka",
    { billingMode: "fixed", markupPct: 0, fixedFee: 20000, currency: "JPY" },
    [usage("Intake", "gemini-2.5-flash", 0, 55.5)],
    rate("JPY", 147.98),
    { number: "ST-2026-0003", issueDate: "2026-10-05", dueDate: "2026-11-04" },
    { status: "closed" },
  ),
  // Left out: a draft, and an absorbed client with nothing billed.
  statement(
    "Draft Ltd",
    "draft",
    { billingMode: "passthrough", markupPct: 0, fixedFee: 0, currency: "USD" },
    [usage("X", "gpt-5", 10)],
    null,
    { number: null, issueDate: null, dueDate: null },
    { status: "draft" },
  ),
  statement(
    "Initech",
    "initech",
    { billingMode: "absorbed", markupPct: 0, fixedFee: 0, currency: "USD" },
    [usage("Pilot", "gpt-5", 0, 3)],
    null,
    { number: "ST-2026-0004", issueDate: "2026-10-02", dueDate: "2026-10-16" },
    { status: "closed" },
  ),
];

export const FIXTURE_PERIOD = PERIOD;
export const FIXTURE_NOW = new Date("2026-10-12T08:30:15.123Z");
