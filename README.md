# LLMpense

**Know what you spend on AI, in tokens and dollars, for every client and project.**

LLMpense is a self-hostable AI spend tracker for agencies and dev shops that build
AI features for clients. Point your OpenAI, Anthropic or Gemini SDK at the LLMpense
proxy, tag requests with a client and project, and see what you spend per client,
project, model and feature, plus what each client is billed for it. It works on
phone and desktop.

> Status: early MVP (v0.1). Expect breaking changes.

## Screenshots

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/desktop-overview-dark.png">
  <img alt="Overview on desktop: total AI spend, tokens, daily cost per client" src=".github/screenshots/desktop-overview-light.png">
</picture>

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/mobile-overview-dark.png">
  <img alt="Overview on a phone" src=".github/screenshots/mobile-overview-light.png" width="260">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/mobile-chart-dark.png">
  <img alt="Daily cost chart on a phone" src=".github/screenshots/mobile-chart-light.png" width="260">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/mobile-client-dark.png">
  <img alt="Client detail on a phone" src=".github/screenshots/mobile-client-light.png" width="260">
</picture>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/desktop-client-dark.png">
  <img alt="Client detail on desktop: spend, billing and daily cost per project" src=".github/screenshots/desktop-client-light.png">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshots/desktop-statements-dark.png">
  <img alt="Monthly statements: what each client is billed per month, with month close" src=".github/screenshots/desktop-statements-light.png">
</picture>

<p align="center">
  <img alt="Client-facing statement, ready to print or save as PDF" src=".github/screenshots/client-statement.png" width="520">
</p>

## How it works

```
your app ──► LLMpense proxy ──► OpenAI / Anthropic / Gemini
              │  reads token usage from the response (streaming included)
              ▼
           Postgres ◄── ingest API (for usage you report yourself)
              ▲
           dashboard: cost, billed, margin, budgets, CSV export
```

- **Drop-in proxy.** Change the base URL and add headers. Your provider key passes
  through untouched and is never stored.
- **Per-client billing rules.** Markup, pass-through, fixed monthly fee or absorbed.
- **Authoritative cost.** Prices are merged from four public price lists, with your
  own overrides and negotiated discounts on top (see [Price data](#price-data)).
- **Budgets and alerts** per org, client or project.
- **Fixed-fee loss alerts** when a fixed-fee client's month-to-date provider cost exceeds
  the part of its fee earned so far.
- **Monthly statements** per client and calendar month (UTC). Drafts are computed live;
  closing a month freezes its totals and line items, and a closed month can be reopened.
- **Client-facing statements** with your agency's name, address, logo and footer, showing
  only what the client is billed. Print-ready, so "Save as PDF" gives a clean A4 document.
- **Accounting CSV**: line items per statement, one row per client per month, and the
  monthly usage export per client.

## Quick start

Requirements: Node 22+, pnpm, Docker.

```bash
cp .env.example .env          # optional: set ADMIN_PASSWORD (+ SESSION_SECRET) to require a login
docker compose up -d --wait   # Postgres on localhost:5433
pnpm install
pnpm db:migrate
pnpm db:seed                  # demo agency with 60 days of traffic; prints an API key
pnpm dev                      # dashboard http://localhost:3000, proxy http://localhost:8787
```

Send a request through the proxy:

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "http://localhost:8787/openai/v1",
  defaultHeaders: {
    "x-llmpense-key": process.env.LLMPENSE_KEY,   // lpk_... from Settings or the seed output
    "x-llmpense-client": "acme-retail",
    "x-llmpense-project": "support-bot",
  },
});
```

More SDK examples (Anthropic, Python, curl): [apps/proxy/README.md](apps/proxy/README.md).

## Already using a gateway?

LLMpense can import usage pushed from tools you already run, without moving traffic to the proxy:

- **LiteLLM proxy** via its `generic_api` logging callback
- **Helicone** via webhooks (signature verification supported)
- **OpenRouter** via Broadcast to a webhook destination

Costs are computed from the LLMpense price table, and requests are attributed to clients and
projects from metadata keys or `client:` / `project:` tags. Setup per tool:
[apps/web/INTEGRATIONS.md](apps/web/INTEGRATIONS.md).

## Repository layout

| Path | What |
|---|---|
| `apps/proxy` | Streaming metering proxy (Hono) |
| `apps/web` | Dashboard and ingest API (Next.js) |
| `packages/core` | Usage event schema, pricing, cost and billing rules, price sync |
| `packages/db` | Postgres schema (Drizzle), migrations, event recording, demo seed |

## Price data

The bundled price table is compiled by `pnpm prices:sync` from these MIT-licensed
price lists:

- [LiteLLM](https://github.com/BerriAI/litellm)
- [genai-prices](https://github.com/pydantic/genai-prices) by Pydantic
- [models.dev](https://github.com/sst/models.dev)
- [Portkey Models](https://github.com/Portkey-AI/models)

Their license notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

LLMpense is **source-available** under the
[Functional Source License 1.1, Apache 2.0 Future License](LICENSE) (FSL-1.1-ALv2).
You can use, modify and self-host it freely, including for client work. You may
not offer it as a competing commercial product or service. Every release becomes
Apache-2.0 two years after it is published. Contributions require signing the
[CLA](CLA.md); see [CONTRIBUTING.md](CONTRIBUTING.md).

