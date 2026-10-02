# @llmpense/proxy

Streaming reverse proxy that meters AI API usage per client and project. Point your
provider SDK at the proxy, add your LLMpense key and attribution headers, and every call
lands in `usage_events` with tokens, cost and the client's billed amount.

| Route | Upstream (env var, default) |
|-------|-----------------------------|
| `/openai/*` | `OPENAI_BASE_URL`, `https://api.openai.com` |
| `/anthropic/*` | `ANTHROPIC_BASE_URL`, `https://api.anthropic.com` |
| `/gemini/*` | `GEMINI_BASE_URL`, `https://generativelanguage.googleapis.com` |
| `GET /healthz` | - |

Metered endpoints: OpenAI Chat Completions, Responses and Embeddings; Anthropic Messages;
Gemini's OpenAI-compatible Chat Completions and Embeddings (`/v1beta/openai/...`). All other
paths are proxied without metering.

## Run

```sh
pnpm install
pnpm --filter @llmpense/proxy dev          # PROXY_PORT (default 8787), DATABASE_URL from ../../.env
docker build -f apps/proxy/Dockerfile -t llmpense-proxy .   # from the repo root
```

## Headers

| Header | Required | Meaning |
|--------|----------|---------|
| `x-llmpense-key` | yes | LLMpense API key (`lpk_...`). Not a provider key. |
| `x-llmpense-client` | no | Client slug. Unknown slugs are created automatically. |
| `x-llmpense-project` | no | Project slug within the client. |
| `x-llmpense-feature` | no | Feature name, e.g. `chat`, `summarize`. |
| `x-llmpense-end-user` | no | Your end user's id. |
| `x-llmpense-metadata` | no | JSON object stored on the event. |

A key can also have a default client/project, so code that cannot set headers still gets
attributed. All `x-llmpense-*` headers are removed before the request goes upstream. Your
provider key (`Authorization` / `x-api-key`) is passed through untouched and never stored.

For streamed Chat Completions the proxy adds `stream_options.include_usage: true` when the
request does not set it, because OpenAI only reports usage for streams with that option. The
stream then ends with one extra chunk that has an empty `choices` array (the official SDKs
handle this). Such events carry `metadata.usage_injected = true`.

## SDK setup

Replace `http://localhost:8787` with where the proxy runs.

### OpenAI, TypeScript

```ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "http://localhost:8787/openai/v1",
  defaultHeaders: {
    "x-llmpense-key": process.env.LLMPENSE_KEY!,
    "x-llmpense-client": "acme-retail",
    "x-llmpense-project": "support-bot",
  },
});

// Per-request attribution overrides the defaults:
await openai.chat.completions.create(
  { model: "gpt-5-mini", messages: [{ role: "user", content: "Hi" }] },
  { headers: { "x-llmpense-feature": "chat", "x-llmpense-end-user": "user-42" } },
);
```

### OpenAI, Python

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["OPENAI_API_KEY"],
    base_url="http://localhost:8787/openai/v1",
    default_headers={
        "x-llmpense-key": os.environ["LLMPENSE_KEY"],
        "x-llmpense-client": "acme-retail",
        "x-llmpense-project": "support-bot",
    },
)

client.chat.completions.create(
    model="gpt-5-mini",
    messages=[{"role": "user", "content": "Hi"}],
    extra_headers={"x-llmpense-feature": "chat"},
)
```

### Anthropic, TypeScript

```ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: "http://localhost:8787/anthropic",
  defaultHeaders: {
    "x-llmpense-key": process.env.LLMPENSE_KEY!,
    "x-llmpense-client": "acme-retail",
    "x-llmpense-project": "support-bot",
  },
});
```

### Anthropic, Python

```python
import os
from anthropic import Anthropic

client = Anthropic(
    api_key=os.environ["ANTHROPIC_API_KEY"],
    base_url="http://localhost:8787/anthropic",
    default_headers={
        "x-llmpense-key": os.environ["LLMPENSE_KEY"],
        "x-llmpense-client": "acme-retail",
        "x-llmpense-project": "support-bot",
    },
)
```

### Gemini (OpenAI-compatible endpoint)

Use the OpenAI SDK with `baseURL: "http://localhost:8787/gemini/v1beta/openai/"` and your
Gemini API key as `apiKey`, plus the same `x-llmpense-*` default headers.

### curl

```sh
# OpenAI
curl http://localhost:8787/openai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "x-llmpense-key: $LLMPENSE_KEY" \
  -H "x-llmpense-client: acme-retail" \
  -H "x-llmpense-project: support-bot" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-5-mini","messages":[{"role":"user","content":"Hi"}]}'

# Anthropic
curl http://localhost:8787/anthropic/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-llmpense-key: $LLMPENSE_KEY" \
  -H "x-llmpense-client: acme-retail" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":256,"messages":[{"role":"user","content":"Hi"}]}'
```

A missing or invalid `x-llmpense-key` returns 401 in the provider's error format without
calling the provider.

## How recording works

The response is streamed to the client byte for byte while a tap parses usage on the side
(`src/usage.ts`, pure functions). When the stream ends, the event goes into an in-memory
batcher that writes to Postgres every second or every 100 events, so a slow or failing
database never delays a response. Events still in memory are flushed on SIGTERM; a hard
crash loses at most about a second of events. Upstream errors are recorded only when the
provider reported usage.

## Tests

```sh
pnpm --filter @llmpense/proxy test       # unit + integration (needs DATABASE_URL, uses org slug proxy-test)
pnpm --filter @llmpense/proxy typecheck
```
