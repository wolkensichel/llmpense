import { Hono, type Context } from "hono";
import { HEADERS, LLMPENSE_HEADER_PREFIX } from "@llmpense/core";
import type { RecordContext } from "@llmpense/db";
import type { ProxyEvent, Recorder } from "./batcher.ts";
import type { ProxyConfig } from "./config.ts";
import { log, type KeyInfo, type KeyResolver } from "./keys.ts";
import { classifyEndpoint, prepareRequestBody, UsageCollector, type Extracted, type UpstreamName } from "./usage.ts";

export interface AppDeps {
  config: ProxyConfig;
  keys: KeyResolver;
  recorder: Recorder;
  /** Override for tests. */
  fetch?: typeof fetch;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "expect",
  "host",
]);

/** Encodings that fetch (undici) decodes transparently; the forwarded body is then plain. */
const DECODED_ENCODINGS = new Set(["gzip", "x-gzip", "deflate", "br", "zstd"]);

const UPSTREAMS: UpstreamName[] = ["openai", "anthropic", "gemini"];

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const doFetch = deps.fetch ?? fetch;

  app.get("/healthz", (c) => c.json({ ok: true }));

  for (const name of UPSTREAMS) {
    const handler = (c: Context) => proxy(c, name, deps, doFetch);
    app.all(`/${name}`, handler);
    app.all(`/${name}/*`, handler);
  }

  app.notFound((c) => c.json({ error: { message: "Unknown route. Use /openai/*, /anthropic/* or /gemini/*." } }, 404));
  return app;
}

async function proxy(c: Context, name: UpstreamName, deps: AppDeps, doFetch: typeof fetch): Promise<Response> {
  const startedAt = Date.now();
  const t0 = performance.now();
  const req = c.req.raw;
  const url = new URL(req.url);
  const rest = url.pathname.slice(name.length + 1) || "/";
  const target = deps.config.upstreams[name] + rest + url.search;
  const method = req.method.toUpperCase();

  const rawKey = req.headers.get(HEADERS.key)?.trim();
  if (!rawKey) return errorResponse(name, 401, `Missing ${HEADERS.key} header (your LLMpense API key).`);
  let key: KeyInfo | null;
  try {
    key = await deps.keys.resolve(rawKey);
  } catch (err) {
    log("error", "key lookup failed", { error: String(err) });
    return errorResponse(name, 503, "LLMpense could not verify the API key right now.");
  }
  if (!key) return errorResponse(name, 401, `Invalid or revoked ${HEADERS.key}.`);

  const kind = classifyEndpoint(name, method, rest);
  const attribution = readAttribution(req.headers);
  const headers = forwardHeaders(req.headers);

  let body: BodyInit | null = null;
  let requestModel: string | undefined;
  let usageInjected = false;
  if (method !== "GET" && method !== "HEAD" && req.body) {
    if (kind) {
      // Metered requests are small JSON documents; read them to learn the model and,
      // for streamed chat completions, to ask for usage in the final chunk.
      const prepared = prepareRequestBody(kind, new Uint8Array(await req.arrayBuffer()));
      body = prepared.body;
      requestModel = prepared.model;
      usageInjected = prepared.usageInjected;
      if (usageInjected) headers.delete("content-length");
    } else {
      body = req.body;
    }
  }
  // We parse metered responses, so ask for an uncompressed body.
  if (kind) headers.set("accept-encoding", "identity");

  let upstream: Response;
  try {
    upstream = await doFetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: req.signal,
      // Required by undici to send a ReadableStream body.
      ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    log("warn", "upstream request failed", { upstream: name, target, error: String(err) });
    return errorResponse(name, 502, `LLMpense proxy could not reach the ${name} API.`);
  }

  const resHeaders = responseHeaders(upstream.headers);
  const init = { status: upstream.status, statusText: upstream.statusText, headers: resHeaders };
  if (!kind || !upstream.body) return new Response(upstream.body, init);

  const sse = (upstream.headers.get("content-type") ?? "").includes("text/event-stream");
  const collector = new UsageCollector(kind, sse);

  const finalize = (aborted: boolean) => {
    try {
      const extracted = collector.finish();
      if (!extracted) return;
      const ctx: RecordContext = {
        orgId: key.orgId,
        source: "proxy",
        apiKeyId: key.id,
        defaultClientId: key.defaultClientId,
        defaultProjectId: key.defaultProjectId,
      };
      deps.recorder.add(
        ctx,
        buildEvent({
          name,
          extracted,
          requestModel,
          upstream,
          attribution,
          startedAt,
          latencyMs: Math.round(performance.now() - t0),
          streamed: sse,
          usageInjected,
          aborted,
        }),
      );
    } catch (err) {
      log("error", "usage extraction failed", { upstream: name, error: String(err) });
    }
  };

  return new Response(tap(upstream.body, (chunk) => collector.push(chunk), finalize), init);
}

/**
 * Passes bytes through untouched while observing them. `onEnd` runs once, after the
 * last byte was handed to the client (or when either side aborts).
 */
export function tap(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void,
  onEnd: (aborted: boolean) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let ended = false;
  const end = (aborted: boolean) => {
    if (ended) return;
    ended = true;
    onEnd(aborted);
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        let res: ReadableStreamReadResult<Uint8Array>;
        try {
          res = await reader.read();
        } catch (err) {
          controller.error(err);
          end(true);
          return;
        }
        if (res.done) {
          controller.close();
          end(false);
          return;
        }
        controller.enqueue(res.value);
        try {
          onChunk(res.value);
        } catch (err) {
          log("warn", "usage tap failed", { error: String(err) });
        }
      },
      cancel(reason) {
        end(true);
        return reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

interface Attribution {
  client?: string;
  project?: string;
  feature?: string;
  endUser?: string;
  metadata?: Record<string, unknown>;
}

function readAttribution(h: Headers): Attribution {
  const get = (name: string, max: number) => {
    const v = h.get(name)?.trim();
    return v ? v.slice(0, max) : undefined;
  };
  let metadata: Record<string, unknown> | undefined;
  const rawMeta = h.get(HEADERS.metadata);
  if (rawMeta) {
    try {
      const parsed: unknown = JSON.parse(rawMeta);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      else log("warn", `${HEADERS.metadata} is not a JSON object; ignored`);
    } catch {
      log("warn", `${HEADERS.metadata} is not valid JSON; ignored`);
    }
  }
  return {
    client: get(HEADERS.client, 100),
    project: get(HEADERS.project, 100),
    feature: get(HEADERS.feature, 100),
    endUser: get(HEADERS.endUser, 200),
    metadata,
  };
}

export function forwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  // Headers named in `Connection` are hop-by-hop too.
  const connectionTokens = new Set(
    (incoming.get("connection") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  incoming.forEach((value, name) => {
    const n = name.toLowerCase();
    if (n.startsWith(LLMPENSE_HEADER_PREFIX) || HOP_BY_HOP.has(n) || connectionTokens.has(n)) return;
    out.append(name, value);
  });
  return out;
}

function responseHeaders(upstream: Headers): Headers {
  const out = new Headers();
  const encoding = upstream.get("content-encoding")?.trim().toLowerCase();
  const decoded = !!encoding && encoding.split(",").every((e) => DECODED_ENCODINGS.has(e.trim()));
  upstream.forEach((value, name) => {
    const n = name.toLowerCase();
    if (HOP_BY_HOP.has(n)) return;
    // fetch already decompressed the body, so these no longer describe it.
    if (decoded && (n === "content-encoding" || n === "content-length")) return;
    out.append(name, value);
  });
  return out;
}

function buildEvent(a: {
  name: UpstreamName;
  extracted: Extracted;
  requestModel?: string;
  upstream: Response;
  attribution: Attribution;
  startedAt: number;
  latencyMs: number;
  streamed: boolean;
  usageInjected: boolean;
  aborted: boolean;
}): ProxyEvent {
  const { extracted, attribution: at } = a;
  let model = extracted.model ?? a.requestModel ?? "unknown";
  if (a.name === "gemini") model = model.replace(/^models\//, "");
  const requestId =
    extracted.requestId ?? a.upstream.headers.get("x-request-id") ?? a.upstream.headers.get("request-id") ?? undefined;
  const metadata: Record<string, unknown> = { ...at.metadata };
  if (a.usageInjected) metadata.usage_injected = true;
  if (a.aborted) metadata.aborted = true;
  return {
    ts: new Date(a.startedAt),
    provider: a.name,
    model: model.slice(0, 200),
    requestId: requestId?.slice(0, 200),
    client: at.client,
    project: at.project,
    feature: at.feature,
    endUser: at.endUser,
    ...extracted.usage,
    latencyMs: a.latencyMs,
    status: a.upstream.status,
    streamed: a.streamed,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/** Errors in the shape the provider's SDK expects, so clients surface a useful message. */
export function errorResponse(name: UpstreamName, status: number, message: string): Response {
  let body: unknown;
  if (name === "anthropic") {
    const type = status === 401 ? "authentication_error" : status === 503 ? "overloaded_error" : "api_error";
    body = { type: "error", error: { type, message } };
  } else if (name === "gemini") {
    const s = status === 401 ? "UNAUTHENTICATED" : status === 503 ? "UNAVAILABLE" : "INTERNAL";
    body = { error: { code: status, message, status: s } };
  } else {
    body = {
      error: {
        message,
        type: status === 401 ? "invalid_request_error" : "server_error",
        param: null,
        code: status === 401 ? "invalid_llmpense_key" : null,
      },
    };
  }
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
