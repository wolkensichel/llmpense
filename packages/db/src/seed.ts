/**
 * Demo data: one agency org, four clients with different billing modes, 60 days of
 * traffic, budgets, and an API key printed to stdout. Safe to re-run: it wipes the demo org.
 */
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { generateApiKey } from "./keys.ts";
import { evaluateBudgets, recordEvents } from "./record.ts";
import { apiKeys, budgets, clients, orgs, projects } from "./schema.ts";
import type { UsageEventInput } from "@llmpense/core";

const db = createDb();
const SLUG = "demo-agency";

await db.delete(orgs).where(eq(orgs.slug, SLUG));
const [org] = await db.insert(orgs).values({ name: "Demo Agency", slug: SLUG }).returning();
const orgId = org!.id;

const CLIENTS = [
  { slug: "acme-retail", name: "Acme Retail", billingMode: "markup", markupPct: "30", fixedFeeUsd: "0",
    projects: [["support-bot", "Support bot"], ["product-search", "Product search"]], scale: 1.0 },
  { slug: "northwind-legal", name: "Northwind Legal", billingMode: "fixed", markupPct: "0", fixedFeeUsd: "300",
    projects: [["contract-review", "Contract review"]], scale: 1.6 },
  { slug: "globex-health", name: "Globex Health", billingMode: "passthrough", markupPct: "0", fixedFeeUsd: "0",
    projects: [["intake-assistant", "Intake assistant"], ["summaries", "Visit summaries"]], scale: 0.7 },
  { slug: "initech", name: "Initech", billingMode: "absorbed", markupPct: "0", fixedFeeUsd: "0",
    projects: [["pilot", "Pilot"]], scale: 0.25 },
] as const;

for (const c of CLIENTS) {
  const [row] = await db
    .insert(clients)
    .values({ orgId, slug: c.slug, name: c.name, billingMode: c.billingMode, markupPct: c.markupPct, fixedFeeUsd: c.fixedFeeUsd })
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

const acme = await db.query.clients.findFirst({ where: eq(clients.slug, "acme-retail") });
const northwind = await db.query.clients.findFirst({ where: eq(clients.slug, "northwind-legal") });
await db.insert(budgets).values([
  { orgId, scope: "org", amountUsd: "350" },
  { orgId, scope: "client", clientId: acme!.id, amountUsd: "70" },
  { orgId, scope: "client", clientId: northwind!.id, amountUsd: "150" },
]);
// Evaluate last month too, so a fresh demo has alert history even on the 1st.
const lastMonth = new Date(now);
lastMonth.setUTCDate(0);
await evaluateBudgets(db, orgId, lastMonth);
await evaluateBudgets(db, orgId);

const k = generateApiKey();
await db.insert(apiKeys).values({ orgId, name: "Demo key", prefix: k.prefix, hash: k.hash });

console.log(`seeded org ${orgId} with ${events.length} events`);
console.log(`demo API key: ${k.key}`);
await db.$client.end();
