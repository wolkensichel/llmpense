/**
 * Demo data: one agency org with statement branding, four clients with different billing
 * modes and currencies (USD, EUR, GBP), a few demo exchange rates,
 * 60 days of traffic, budgets, last month's statements closed, and an API key printed
 * to stdout. Safe to re-run: it wipes the demo org.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { createDb } from "./client.ts";
import { generateApiKey } from "./keys.ts";
import { evaluateAlerts, recordEvents } from "./record.ts";
import { closeAllDrafts } from "./statements.ts";
import { apiKeys, budgets, clients, fxRates, orgs, projects } from "./schema.ts";
import { SEED_RATE_SOURCE, type UsageEventInput } from "@llmpense/core";
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
    brandFooter: "Demo Agency, a fictional company for demo purposes.\nPayment within 14 days of the statement date.",
  })
  .returning();
const orgId = org!.id;

// Fixed fees are in each client's billing currency. Globex's statements show one line per
// project (model names hidden); the others follow the org default and name the models.
const CLIENTS = [
  { slug: "acme-retail", name: "Acme Retail", billingMode: "markup", markupPct: "30", fixedFee: "0", currency: "USD", modelNames: "show",
    projects: [["support-bot", "Support bot"], ["product-search", "Product search"]], scale: 1.0 },
  { slug: "northwind-legal", name: "Northwind Legal", billingMode: "fixed", markupPct: "0", fixedFee: "130", currency: "EUR", modelNames: null,
    projects: [["contract-review", "Contract review"]], scale: 1.6 },
  { slug: "globex-health", name: "Globex Health", billingMode: "passthrough", markupPct: "0", fixedFee: "0", currency: "GBP", modelNames: "hide",
    projects: [["intake-assistant", "Intake assistant"], ["summaries", "Visit summaries"]], scale: 0.7 },
  { slug: "initech", name: "Initech", billingMode: "absorbed", markupPct: "0", fixedFee: "0", currency: "USD", modelNames: null,
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
const closed = await closeAllDrafts(db, orgId, lastPeriod, closeDay < today ? closeDay : today);

const k = generateApiKey();
await db.insert(apiKeys).values({ orgId, name: "Demo key", prefix: k.prefix, hash: k.hash });

console.log(`seeded org ${orgId} with ${events.length} events, closed ${closed.closed} statements for ${lastPeriod}`);
console.log(`demo API key: ${k.key}`);
await db.$client.end();
