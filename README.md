# LLMpense

**Know what every client's AI usage costs you, and what you earn on it.**

LLMpense is a self-hostable cost and margin tracker for agencies and dev shops that
build AI features for clients. Point your OpenAI, Anthropic or Gemini SDK at the
LLMpense proxy, tag requests with a client and project, and see provider cost,
what each client is billed, and your margin, per client, project, model and
feature. It works on phone and desktop.

> Status: early MVP (v0.1). Expect breaking changes.

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
- **Monthly CSV export** per client as the basis for invoicing.

## Quick start

Requirements: Node 22+, pnpm, Docker.

```bash
cp .env.example .env          # set ADMIN_PASSWORD and SESSION_SECRET
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

