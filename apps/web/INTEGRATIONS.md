# Importing usage from a gateway

If your traffic already runs through LiteLLM, Helicone or OpenRouter, those tools can push
usage to LLMpense directly. Nothing in your request path changes.

| Tool | Mechanism | Endpoint |
|------|-----------|----------|
| LiteLLM proxy | `generic_api` logging callback | `POST /api/v1/integrations/litellm` |
| Helicone | Webhooks | `POST /api/v1/integrations/helicone` |
| OpenRouter | Broadcast, Webhook destination | `POST` or `PUT /api/v1/integrations/openrouter` |

Every endpoint needs an LLMpense API key (`lpk_...`, created under Settings > API keys).
Settings > Import shows the snippets below with your server's URL filled in.

## How events are stored

- One usage event per request, with `source = ingest` and `metadata.integration` set to
  `litellm`, `helicone` or `openrouter`.
- Cost is computed from the LLMpense price table (bundled list prices plus your overrides).
  The cost the tool reported is kept as `metadata.reportedCostUsd`.
- The tool's request id becomes the event's `requestId`. Redelivered payloads are ignored.
- Provider names are normalized (`vertex_ai` → `vertex`, `google` → `gemini`, `azure_ai` →
  `azure`, ...) and provider prefixes are stripped from model ids
  (`anthropic/claude-sonnet-4-5` → `claude-sonnet-4-5`). Unknown providers are stored as `other`.
- `inputTokens` is uncached input only; cache reads and writes are stored separately.
- Responses: `200 {"received", "inserted", "skipped"}`, `400` with zod `issues` for an
  invalid payload, `401` for a missing or unknown key (or a bad Helicone signature).
  Up to 1,000 items per request.

## Attribution

Client, project and feature are resolved per request, first match wins:

1. Metadata keys `llmpense_client`, `llmpense_project`, `llmpense_feature`.
2. Tags `client:<slug>`, `project:<slug>`, `feature:<slug>`.
3. Query parameters on the endpoint URL: `?client=<slug>&project=<slug>&feature=<slug>`.
4. Client only: the tool's team or end-user field (see each tool below).
5. The API key's default client and project.

Unknown client and project slugs are created automatically, as with the proxy. A project
applies only together with a client.

## LiteLLM

LiteLLM's [Generic API callback](https://docs.litellm.ai/docs/observability/generic_api)
sends a list of [StandardLoggingPayload](https://docs.litellm.ai/docs/proxy/logging_spec)
objects. In the proxy's `config.yaml`:

```yaml
litellm_settings:
  callbacks: ["llmpense"]

callback_settings:
  llmpense:
    callback_type: generic_api
    endpoint: https://llmpense.example.com/api/v1/integrations/litellm
    headers:
      Authorization: Bearer lpk_...
    event_types:
      - llm_api_success
```

`log_format` may be `json_array` (default), `single` or `ndjson`. The key can also be sent as
`x-llmpense-key`. Failure events are skipped. Responses served from LiteLLM's own cache
(`cache_hit: true`) are stored with zero cost.

Attribution sources:

| LLMpense | LiteLLM field |
|----------|---------------|
| metadata keys | request `metadata` (`requester_metadata`), `metadata.spend_logs_metadata` |
| tags | `request_tags` (request `metadata.tags` or `x-litellm-tags`) |
| client fallback | `metadata.user_api_key_team_alias`, then `end_user` (the request's `user`) |

```python
client.chat.completions.create(
    model="claude-sonnet",
    messages=[{"role": "user", "content": "Hello"}],
    extra_body={"metadata": {"llmpense_client": "acme-retail", "llmpense_project": "support-bot"}},
)
```

Tokens: `prompt_tokens` minus `prompt_tokens_details.cached_tokens` is uncached input;
`cache_creation_input_tokens` is stored as cache writes. Provider comes from the
`litellm_model_name` / model prefix, then the API base host. Also stored in metadata:
`keyAlias`, `teamId`, `teamAlias`, `modelGroup`, `traceId`, `sessionId`, `tags`.

## Helicone

Add a [webhook](https://docs.helicone.ai/features/webhooks) with this destination URL and
enable **Include Data** (without it the payload has no model or token counts and is skipped):

```
https://llmpense.example.com/api/v1/integrations/helicone?key=lpk_...&client=acme-retail
```

Helicone webhooks are configured with a URL only, so this endpoint also accepts the key as
`?key=`. Treat the URL like a secret. To check signatures, put the webhook's HMAC key on the
LLMpense server:

```sh
HELICONE_WEBHOOK_SECRET=...
```

With it set, requests without a valid `helicone-signature` (HMAC-SHA256, compared in constant
time) are rejected.

The webhook payload has no custom properties, so attribution comes from the URL query
parameters or the `user_id` (Helicone-User-Id) as client fallback. Use Helicone's property
filters with one webhook per client to split traffic. The payload has no cache breakdown,
so all prompt tokens are priced as uncached input.

## OpenRouter

In OpenRouter, Settings > Observability, enable **Broadcast** and configure the
[Webhook destination](https://openrouter.ai/docs/guides/features/broadcast/webhook):

- URL: `https://llmpense.example.com/api/v1/integrations/openrouter`
- Method: `POST` (or `PUT`)
- Headers: `{"Authorization": "Bearer lpk_..."}`

The connection test (an empty payload) returns 200. OpenRouter sends OTLP JSON traces; each
span with `gen_ai.usage.*` token counts becomes one event, keyed by `gen_ai.response.id`.

Attribution comes from the request's [`trace` object](https://openrouter.ai/docs/guides/features/broadcast)
(sent as `trace.metadata.*` attributes) and `user`:

```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [{ "role": "user", "content": "Hello" }],
  "user": "user_12345",
  "trace": { "llmpense_client": "acme-retail", "llmpense_project": "support-bot", "tags": "feature:chat" }
}
```

`trace.tags` may be a comma-separated string or an array. The client fallback is `user`.

Tokens: `gen_ai.usage.input_tokens` (or `prompt_tokens`) minus
`gen_ai.usage.input_tokens.cache_write` is uncached input; cache writes are stored
separately. The OTLP export has no documented cache-read attribute, so cache reads are priced
as uncached input. The model's author prefix sets the provider (`google/...` → `gemini`,
`anthropic/...` → `anthropic`); models from other authors are stored as `other` and need a
price override to be priced.
