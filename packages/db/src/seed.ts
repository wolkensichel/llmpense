/**
 * Demo data: one agency org with statement branding, four clients with different billing
 * modes and currencies (USD, EUR, GBP), a few demo exchange rates, 60 days of traffic, runs
 * with outcomes (tickets resolved, contracts reviewed, intakes completed), budgets, last
 * month's statements closed with numbers and then marked as sent or paid, and an API key
 * printed to stdout. Safe to re-run: it wipes the demo org.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { createDb } from "./client.ts";
import { generateApiKey } from "./keys.ts";
import { evaluateAlerts, recordEvents } from "./record.ts";
import { closeAllDrafts, markStatement } from "./statements.ts";
import { apiKeys, budgets, clients, fxRates, orgs, projects } from "./schema.ts";
import { SEED_RATE_SOURCE, type OutcomeInput, type UsageEventInput } from "@llmpense/core";
import { upsertOutcomes } from "./results.ts";
import { upsertEurRates } from "./fx.ts";

const db = createDb();
const SLUG = "demo-agency";

await db.delete(orgs).where(eq(orgs.slug, SLUG));
const [org] = await db
  .insert(orgs)
  .values({
    name: "Demo Agency",
    slug: SLUG,
    brandName: "Demo Agency",
    brandAddress: "Example Street 1\n00100 Example City\nbilling@demo-agency.example",
    brandFooter: "Demo Agency, a fictional company for demo purposes.\nPlease pay by the due date shown above.",
    statementNumberFormat: "ST-{YYYY}-{NNNN}",
    paymentTermsDays: 14,
  })
  .returning();
const orgId = org!.id;

// Fixed fees are in each client's billing currency. Globex's statements show one line per
// project (model names hidden); the others follow the org default and name the models.
// Payment terms: Northwind pays within 30 days, Globex within 7, the others use the org's 14.
const CLIENTS = [
  { slug: "acme-retail", name: "Acme Retail", billingMode: "markup", markupPct: "30", fixedFee: "0", currency: "USD", modelNames: "show", terms: null,
    projects: [["support-bot", "Support bot"], ["product-search", "Product search"]], scale: 1.0 },
  { slug: "northwind-legal", name: "Northwind Legal", billingMode: "fixed", markupPct: "0", fixedFee: "130", currency: "EUR", modelNames: null, terms: 30,
    projects: [["contract-review", "Contract review"]], scale: 1.6 },
  { slug: "globex-health", name: "Globex Health", billingMode: "passthrough", markupPct: "0", fixedFee: "0", currency: "GBP", modelNames: "hide", terms: 7,
    projects: [["intake-assistant", "Intake assistant"], ["summaries", "Visit summaries"]], scale: 0.7 },
  { slug: "initech", name: "Initech", billingMode: "absorbed", markupPct: "0", fixedFee: "0", currency: "USD", modelNames: null, terms: null,
    projects: [["pilot", "Pilot"]], scale: 0.25 },
] as const;

for (const c of CLIENTS) {
  const [row] = await db
    .insert(clients)
    .values({
      orgId,
      slug: c.slug,
      name: c.name,
      billingMode: c.billingMode,
      markupPct: c.markupPct,
      fixedFee: c.fixedFee,
      billingCurrency: c.currency,
      modelNames: c.modelNames,
      paymentTermsDays: c.terms,
    })
    .returning();
  await db.insert(projects).values(c.projects.map(([slug, name]) => ({ orgId, clientId: row!.id, slug, name })));
}

const MODELS: { provider: UsageEventInput["provider"]; model: string; weight: number }[] = [
  { provider: "anthropic", model: "claude-sonnet-5-5", weight: 4 },
  { provider: "anthropic", model: "claude-haiku-4-5", weight: 3 },
  { provider: "anthropic", model: "claude-opus-5-5", weight: 1 },
  { provider: "openai", model: "gpt-5-mini", weight: 3 },
  { provider: "openai", model: "gpt-5", weight: 1 },
  { provider: "gemini", model: "gemini-2.5-flash", weight: 2 },
];
const FEATURES = ["chat", "summarize", "classify", "extract"];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T extends { weight: number }>(xs: T[]) => {
  let r = rand() * xs.reduce((a, x) => a + x.weight, 0);
  for (const x of xs) if ((r -= x.weight) <= 0) return x;
  return xs[0]!;
};

const now = Date.now();
const DAY = 86_400_000;
const events: UsageEventInput[] = [];
for (let d = 59; d >= 0; d--) {
  for (const c of CLIENTS) {
    // Gentle growth over time plus weekday seasonality.
    const day = new Date(now - d * DAY);
    const weekday = day.getUTCDay() % 6 === 0 ? 0.4 : 1;
    const n = Math.round((60 + (60 - d) * 1.8) * c.scale * weekday * (0.8 + rand() * 0.4));
    for (let i = 0; i < n; i++) {
      const m = pick(MODELS);
      const input = Math.round(2000 + rand() * 28000);
      const cached = rand() < 0.4 ? Math.round(input * (0.5 + rand() * 0.4)) : 0;
      events.push({
        ts: new Date(day.getTime() - rand() * DAY * 0.9),
        provider: m.provider,
        model: m.model,
        client: c.slug,
        project: c.projects[Math.floor(rand() * c.projects.length)]![0],
        feature: FEATURES[Math.floor(rand() * FEATURES.length)],
        inputTokens: input - cached,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
        outputTokens: Math.round(300 + rand() * 2700),
        latencyMs: Math.round(400 + rand() * 4000),
        status: rand() < 0.02 ? 500 : 200,
      });
    }
  }
}

for (let i = 0; i < events.length; i += 1000) {
  await recordEvents(db, { orgId, source: "seed" }, events.slice(i, i + 1000));
}

// Runs and outcomes (cost per result). Each run is one task handled by one model in a few calls;
// models differ in cost and success rate so the per-model comparison has something to show.
// Runs whose last call is less than six hours old, and a few abandoned ones, have no outcome yet.
type RunModel = { provider: UsageEventInput["provider"]; model: string; weight: number; success: number; calls: [number, number] };
const RUN_FLOWS: {
  client: string;
  project: string;
  feature: string;
  outcome: string;
  perDay: number;
  value?: { amount: number; currency: "USD" | "EUR" | "GBP" };
  input: [number, number];
  output: [number, number];
  models: RunModel[];
}[] = [
  {
    client: "acme-retail", project: "support-bot", feature: "chat", outcome: "ticket_resolved", perDay: 14,
    value: { amount: 4, currency: "USD" }, input: [6000, 16000], output: [250, 900],
    models: [
      { provider: "anthropic", model: "claude-sonnet-5-5", weight: 5, success: 0.87, calls: [2, 4] },
      { provider: "openai", model: "gpt-5-mini", weight: 4, success: 0.72, calls: [3, 6] },
      { provider: "anthropic", model: "claude-haiku-4-5", weight: 3, success: 0.8, calls: [2, 5] },
      { provider: "gemini", model: "gemini-2.5-flash", weight: 0.3, success: 0.85, calls: [2, 4] },
    ],
  },
  {
    client: "northwind-legal", project: "contract-review", feature: "extract", outcome: "document_reviewed", perDay: 2,
    value: { amount: 40, currency: "EUR" }, input: [10000, 22000], output: [600, 1600],
    models: [
      { provider: "anthropic", model: "claude-opus-5-5", weight: 2, success: 0.97, calls: [3, 5] },
      { provider: "anthropic", model: "claude-sonnet-5-5", weight: 3, success: 0.91, calls: [3, 6] },
      { provider: "openai", model: "gpt-5", weight: 1, success: 0.86, calls: [3, 6] },
    ],
  },
  {
    client: "globex-health", project: "intake-assistant", feature: "classify", outcome: "intake_completed", perDay: 8,
    input: [3000, 9000], output: [200, 700],
    models: [
      { provider: "openai", model: "gpt-5-mini", weight: 3, success: 0.71, calls: [2, 5] },
      { provider: "gemini", model: "gemini-2.5-flash", weight: 2, success: 0.82, calls: [2, 4] },
      { provider: "anthropic", model: "claude-haiku-4-5", weight: 2, success: 0.79, calls: [2, 4] },
    ],
  },
];
const between = ([lo, hi]: [number, number]) => Math.round(lo + rand() * (hi - lo));
const runEvents: UsageEventInput[] = [];
const runOutcomes: OutcomeInput[] = [];
let runSeq = 0;
for (let d = 59; d >= 0; d--) {
  const day = new Date(now - d * DAY);
  const weekday = day.getUTCDay() % 6 === 0 ? 0.5 : 1;
  for (const f of RUN_FLOWS) {
    const n = Math.round(f.perDay * weekday * (0.8 + rand() * 0.4));
    for (let i = 0; i < n; i++) {
      const m = pick(f.models);
      const runId = `${f.outcome.split("_")[0]}-${(++runSeq).toString().padStart(5, "0")}`;
      let t = day.getTime() - rand() * DAY * 0.9;
      const calls = between(m.calls);
      for (let c = 0; c < calls; c++) {
        const input = between(f.input);
        const cached = c > 0 && rand() < 0.5 ? Math.round(input * 0.6) : 0;
        runEvents.push({
          ts: new Date(t),
          provider: m.provider,
          model: m.model,
          client: f.client,
          project: f.project,
          feature: f.feature,
          runId,
          inputTokens: input - cached,
          cacheReadTokens: cached,
          cacheWriteTokens: 0,
          outputTokens: between(f.output),
          latencyMs: Math.round(600 + rand() * 5000),
          status: 200,
        });
        t += 5_000 + rand() * 55_000;
      }
      const reportedAt = t + 120_000 + rand() * 2_400_000;
      if (now - t < 6 * 3_600_000 || reportedAt > now || rand() < 0.03) continue;
      const success = rand() < m.success;
      runOutcomes.push({
        runId,
        name: f.outcome,
        status: success ? "success" : "failure",
        value: success && f.value ? f.value : undefined,
        ts: new Date(reportedAt),
        metadata: { seed: true },
      });
    }
  }
}
for (let i = 0; i < runEvents.length; i += 1000) {
  await recordEvents(db, { orgId, source: "seed" }, runEvents.slice(i, i + 1000));
}
await upsertOutcomes(db, orgId, runOutcomes);

// A small fixed set of exchange rates (per 1 EUR) so the demo works offline: the last business
// day of each seeded month and the latest business day so far. They are labelled as seed data
// and never replace stored ECB rates; `pnpm fx:sync` or the web app's daily fetch overwrite them.
const SEED_RATES = { USD: 1.165, GBP: 0.865, JPY: 172.4, CNY: 8.32, CHF: 0.935 };
const DRIFT = [0.996, 1.0, 1.003, 1.001];
const shiftDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastBusinessDay = (d: Date) => {
  const x = new Date(d);
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
};
const rateDays = [3, 2, 1].map((back) => {
  const t = new Date(now);
  return lastBusinessDay(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - back + 1, 0)));
});
rateDays.push(lastBusinessDay(new Date(now)));
// Skip them entirely when ECB rates for the seeded months are already stored (an online install).
const [ecbRow] = await db
  .select({ date: fxRates.date })
  .from(fxRates)
  .where(and(eq(fxRates.source, "ecb"), lte(fxRates.date, rateDays[0]!), gte(fxRates.date, shiftDays(rateDays[0]!, -7))))
  .limit(1);
if (!ecbRow) await upsertEurRates(
  db,
  rateDays.flatMap((date, i) =>
    Object.entries(SEED_RATES).map(([currency, rate]) => ({
      date,
      currency,
      ratePerEur: Math.round(rate * DRIFT[i]! * 10_000) / 10_000,
      source: SEED_RATE_SOURCE,
    })),
  ),
  { overwrite: false },
);

const acme = await db.query.clients.findFirst({ where: eq(clients.slug, "acme-retail") });
const northwind = await db.query.clients.findFirst({ where: eq(clients.slug, "northwind-legal") });
await db.insert(budgets).values([
  { orgId, scope: "org", amountUsd: "350" },
  { orgId, scope: "client", clientId: acme!.id, amountUsd: "70" },
  { orgId, scope: "client", clientId: northwind!.id, amountUsd: "150" },
]);
// Evaluate last month too, so a fresh demo has alert history even on the 1st. With traffic
// growing, Northwind's fixed fee covers last month but not the current one.
const lastMonth = new Date(now);
lastMonth.setUTCDate(0);
await evaluateAlerts(db, orgId, lastMonth);
await evaluateAlerts(db, orgId);

// Last month is closed (on the 2nd, or right now on the 1st); the current month stays a draft.
const today = new Date(now);
const closeDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 2, 9));
const lastPeriod = lastMonth.toISOString().slice(0, 7);
const closedAt = closeDay < today ? closeDay : today;
const closed = await closeAllDrafts(db, orgId, lastPeriod, closedAt);

// Then they went out: Acme has paid, Northwind (30 days) and Globex (7 days) are sent, and Globex is
// overdue once its due date has passed. Initech is billed nothing and stays closed.
const at = (hours: number) => new Date(Math.min(closedAt.getTime() + hours * 3_600_000, now));
const clientId = async (slug: string) => (await db.query.clients.findFirst({ where: and(eq(clients.orgId, orgId), eq(clients.slug, slug)) }))!.id;
const sentIds = [await clientId("acme-retail"), await clientId("northwind-legal"), await clientId("globex-health")];
for (const id of sentIds) await markStatement(db, orgId, id, lastPeriod, "mark_sent", { now: at(2) });
await markStatement(db, orgId, sentIds[0]!, lastPeriod, "mark_paid", { now: at(5 * 24) });

const k = generateApiKey();
await db.insert(apiKeys).values({ orgId, name: "Demo key", prefix: k.prefix, hash: k.hash });

console.log(`seeded org ${orgId} with ${events.length + runEvents.length} events and ${runOutcomes.length} outcomes, closed ${closed.closed} statements for ${lastPeriod}, 3 sent, 1 paid`);
console.log(`demo API key: ${k.key}`);
await db.$client.end();
