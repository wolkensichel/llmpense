import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { BILLING_MODES, PROVIDERS } from "@llmpense/core";

// Money columns are numeric; drizzle returns them as strings to avoid float loss.
const usd = (name: string) => numeric(name, { precision: 18, scale: 8 });
const ratePerMTok = (name: string) => numeric(name, { precision: 14, scale: 6 });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const providerEnum = pgEnum("provider", PROVIDERS);
export const billingModeEnum = pgEnum("billing_mode", BILLING_MODES);
export const eventSourceEnum = pgEnum("event_source", ["proxy", "ingest", "seed"]);
export const budgetScopeEnum = pgEnum("budget_scope", ["org", "client", "project"]);

/** Tenant. Most self-hosted installs have one. */
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  currency: text("currency").notNull().default("USD"),
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
    /** Monthly flat fee covering AI usage, for billing_mode = fixed. */
    fixedFeeUsd: usd("fixed_fee_usd").notNull().default("0"),
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

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
    threshold: integer("threshold").notNull(),
    /** First day of the budget month, UTC, as YYYY-MM-DD. */
    periodStart: text("period_start").notNull(),
    spendUsd: usd("spend_usd").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("alerts_once_per_period").on(t.budgetId, t.threshold, t.periodStart)],
);
