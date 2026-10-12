import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { BILLING_MODES, CURRENCIES, MODEL_NAME_DISPLAY, PROVIDERS, STATEMENT_LINE_KINDS, STATEMENT_STATUSES } from "@llmpense/core";

// Money columns are numeric; drizzle returns them as strings to avoid float loss.
const usd = (name: string) => numeric(name, { precision: 18, scale: 8 });
const ratePerMTok = (name: string) => numeric(name, { precision: 14, scale: 6 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const providerEnum = pgEnum("provider", PROVIDERS);
export const billingModeEnum = pgEnum("billing_mode", BILLING_MODES);
export const eventSourceEnum = pgEnum("event_source", ["proxy", "ingest", "seed"]);
export const budgetScopeEnum = pgEnum("budget_scope", ["org", "client", "project"]);
export const alertKindEnum = pgEnum("alert_kind", ["budget", "fixed_fee_loss"]);
export const statementStatusEnum = pgEnum("statement_status", STATEMENT_STATUSES);
export const statementLineKindEnum = pgEnum("statement_line_kind", STATEMENT_LINE_KINDS);
export const currencyEnum = pgEnum("currency", CURRENCIES);
export const modelNameDisplayEnum = pgEnum("model_name_display", MODEL_NAME_DISPLAY);

/** An amount in a client's billing currency (JPY has no decimals, the others two). */
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });
/** Units of a currency per 1 EUR or per 1 USD. */
const fxRate = (name: string) => numeric(name, { precision: 20, scale: 10 });

/** Tenant. Most self-hosted installs have one. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("USD"),
  /** Agency name on client-facing statements; falls back to `name`. */
  brandName: text("brand_name"),
  /** Postal address or other contact lines, shown under the agency name. */
  brandAddress: text("brand_address"),
  /** Footer text on client-facing statements (payment details, registration numbers). */
  brandFooter: text("brand_footer"),
  /** http(s) URL of a logo image. */
  brandLogoUrl: text("brand_logo_url"),
  /** Default for client-facing statements: name the model on each line, or one line per project. */
  showModelNames: boolean("show_model_names").notNull().default(true),
  createdAt: createdAt(),
});

/** An agency's customer. */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    billingMode: billingModeEnum("billing_mode").notNull().default("markup"),
    markupPct: numeric("markup_pct", { precision: 7, scale: 2 }).notNull().default("0"),
    /** Currency statements are billed in. Usage is metered and billed in USD and converted per month. */
    billingCurrency: currencyEnum("billing_currency").notNull().default("USD"),
    /** Monthly flat fee covering AI usage, for billing_mode = fixed, in the billing currency. */
    fixedFee: usd("fixed_fee").notNull().default("0"),
    /** Model names on client-facing statements; null follows the org default. */
    modelNames: modelNameDisplayEnum("model_names"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("clients_org_slug").on(t.orgId, t.slug)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("projects_client_slug").on(t.clientId, t.slug)],
);

/**
 * LLMpense API keys (not provider keys). Sent as `x-llmpense-key` to the proxy or as a
 * Bearer token to the ingest API. A key may pin a default client/project so client
 * code needs no attribution headers at all.
 */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** First chars of the key, shown in the UI to identify it. */
  prefix: text("prefix").notNull(),
  /** sha256 hex of the full key. */
  hash: text("hash").notNull().unique(),
  defaultClientId: uuid("default_client_id").references(() => clients.id, { onDelete: "set null" }),
  defaultProjectId: uuid("default_project_id").references(() => projects.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Price overrides and history. org_id null = global price. Rows here take precedence
 * over the bundled snapshot in @llmpense/core; an org row beats a global row (negotiated discounts).
 */
export const modelPrices = pgTable(
  "model_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull(),
    model: text("model").notNull(),
    inputPerMTok: ratePerMTok("input_per_mtok").notNull(),
    outputPerMTok: ratePerMTok("output_per_mtok").notNull(),
    cacheReadPerMTok: ratePerMTok("cache_read_per_mtok"),
    cacheWritePerMTok: ratePerMTok("cache_write_per_mtok"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("model_prices_lookup").on(t.provider, t.model, t.effectiveFrom)],
);

/** The atomic record. Everything in the UI is an aggregation over this table. */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    source: eventSourceEnum("source").notNull(),
    provider: providerEnum("provider").notNull(),
    model: text("model").notNull(),
    requestId: text("request_id"),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    feature: text("feature"),
    endUser: text("end_user"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: usd("cost_usd").notNull().default("0"),
    /** What the client is charged for this event under its billing mode at ingest time. */
    billedUsd: usd("billed_usd").notNull().default("0"),
    /** False when no price matched; cost_usd is 0 and needs repricing. */
    priced: boolean("priced").notNull().default(true),
    latencyMs: integer("latency_ms"),
    status: integer("status"),
    streamed: boolean("streamed").notNull().default(false),
    outcome: text("outcome"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("usage_events_org_ts").on(t.orgId, t.ts),
    index("usage_events_org_client_ts").on(t.orgId, t.clientId, t.ts),
    index("usage_events_org_project_ts").on(t.orgId, t.projectId, t.ts),
    uniqueIndex("usage_events_dedupe")
      .on(t.orgId, t.provider, t.requestId)
      .where(sql`${t.requestId} is not null`),
  ],
);

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  scope: budgetScopeEnum("scope").notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  /** Monthly spend limit (provider cost, not billed). */
  amountUsd: usd("amount_usd").notNull(),
  /** Percent thresholds that fire an alert, e.g. {50,80,100}. */
  thresholds: integer("thresholds").array().notNull().default(sql`'{50,80,100}'`),
  createdAt: createdAt(),
});

/**
 * Alert history. `budget` alerts fire when spend crosses a budget threshold; `fixed_fee_loss`
 * alerts fire when a fixed-fee client's month-to-date cost exceeds its prorated fee to date.
 * Each fires at most once per period.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    kind: alertKindEnum("kind").notNull().default("budget"),
    budgetId: uuid("budget_id").references(() => budgets.id, { onDelete: "cascade" }),
    /** The client a fixed_fee_loss alert is about (budget alerts use the budget's client). */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    /** Budget threshold in percent; null for fixed_fee_loss. */
    threshold: integer("threshold"),
    /** First day of the month, UTC, as YYYY-MM-DD. */
    periodStart: text("period_start").notNull(),
    /** Provider cost when the alert fired. */
    spendUsd: usd("spend_usd").notNull(),
    /** fixed_fee_loss: the part of the monthly fee earned at that moment. */
    feeUsd: usd("fee_usd"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("alerts_once_per_period").on(t.budgetId, t.threshold, t.periodStart),
    uniqueIndex("alerts_fixed_fee_loss_once")
      .on(t.clientId, t.periodStart)
      .where(sql`${t.kind} = 'fixed_fee_loss'`),
    check(
      "alerts_kind_fields",
      sql`(${t.kind} = 'budget' and ${t.budgetId} is not null and ${t.threshold} is not null) or (${t.kind} = 'fixed_fee_loss' and ${t.clientId} is not null)`,
    ),
  ],
);

/**
 * One client's statement for one calendar month (UTC). Drafts are computed live and need no
 * row; a row exists once a month has been closed. While closed, the terms, totals and line
 * items are frozen. Reopening sets the status back to draft and clears the snapshot.
 */
export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    /** YYYY-MM */
    period: text("period").notNull(),
    status: statementStatusEnum("status").notNull().default("draft"),
    clientName: text("client_name"),
    billingMode: billingModeEnum("billing_mode"),
    markupPct: numeric("markup_pct", { precision: 7, scale: 2 }),
    /** The monthly fee in effect when the statement was closed, in the billing currency. */
    monthlyFee: usd("monthly_fee"),
    /** Billing currency and the exchange rate (1 USD = fx_rate units) frozen at close. */
    currency: currencyEnum("currency"),
    fxRate: fxRate("fx_rate"),
    /** Date of the rate (YYYY-MM-DD); null for USD. */
    fxDate: date("fx_date", { mode: "string" }),
    /** identity (USD), ecb, manual or seed. */
    fxSource: text("fx_source"),
    requests: bigint("requests", { mode: "number" }),
    tokens: bigint("tokens", { mode: "number" }),
    costUsd: usd("cost_usd"),
    usageBilledUsd: usd("usage_billed_usd"),
    /** USD equivalent of the fixed fee billed for the month. */
    fixedFeeUsd: usd("fixed_fee_usd"),
    totalBilledUsd: usd("total_billed_usd"),
    /** Amounts in the billing currency, as printed on the statement. */
    usageBilled: money("usage_billed"),
    fixedFee: money("fixed_fee"),
    totalBilled: money("total_billed"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("statements_client_period").on(t.clientId, t.period), index("statements_org_period").on(t.orgId, t.period)],
);

/** Frozen line items of a closed statement: one per project and model, plus the fixed fee. */
export const statementLines = pgTable(
  "statement_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id").notNull().references(() => statements.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: statementLineKindEnum("kind").notNull(),
    project: text("project").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    requests: bigint("requests", { mode: "number" }).notNull().default(0),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }).notNull().default(0),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull().default(0),
    costUsd: usd("cost_usd").notNull().default("0"),
    billedUsd: usd("billed_usd").notNull().default("0"),
    /** Billed in the statement's currency, rounded to its minor unit. */
    billed: money("billed"),
  },
  (t) => [index("statement_lines_statement").on(t.statementId, t.position)],
);

/**
 * Euro foreign exchange reference rates: units of `currency` per 1 EUR on `date`. Filled by
 * `pnpm fx:sync` and on demand by the web app from the ECB feeds; `source` is `ecb`, or
 * `seed (demo data, not ECB)` for rows the demo seed inserts. Shared by all orgs.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date", { mode: "string" }).notNull(),
    currency: text("currency").notNull(),
    ratePerEur: fxRate("rate_per_eur").notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.date, t.currency] }), check("fx_rates_positive", sql`${t.ratePerEur} > 0`)],
);

/**
 * Manual exchange rates per org (1 USD = rate_per_usd units), valid from `effective_from`.
 * They take precedence over the reference rates, e.g. for offline installs or contractual rates.
 */
export const fxRateOverrides = pgTable(
  "fx_rate_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    currency: currencyEnum("currency").notNull(),
    ratePerUsd: fxRate("rate_per_usd").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("fx_rate_overrides_org_currency_from").on(t.orgId, t.currency, t.effectiveFrom),
    check("fx_rate_overrides_positive", sql`${t.ratePerUsd} > 0`),
  ],
);
