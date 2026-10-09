/**
 * OpenRouter Broadcast "Webhook" destination. OpenRouter POSTs (or PUTs) OTLP/HTTP JSON
 * (`resourceSpans[].scopeSpans[].spans[]`) with GenAI semantic-convention attributes, and sends
 * the custom headers configured on the destination.
 * Spec: https://openrouter.ai/docs/guides/features/broadcast/webhook
 *       https://openrouter.ai/docs/guides/features/broadcast/otel-collector#billing-quantities
 */
import { z } from "zod";
import type { UsageEventInput } from "@llmpense/core";
import { compact, int, num, resolveAttribution, resolveModel, type MapResult, type QueryDefaults } from "./common.ts";

const anyValue: z.ZodType<OtlpValue> = z.lazy(() =>
  z.looseObject({
    stringValue: z.string().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.union([z.number(), z.string()]).optional(),
    boolValue: z.boolean().optional(),
    arrayValue: z.looseObject({ values: z.array(anyValue).optional() }).optional(),
  }),
);
interface OtlpValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number | string;
  boolValue?: boolean;
  arrayValue?: { values?: OtlpValue[] };
}

const attributes = z.array(z.looseObject({ key: z.string(), value: anyValue.optional() })).optional();

const span = z.looseObject({
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  name: z.string().optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  endTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  attributes,
});
type Span = z.infer<typeof span>;

export const openrouterBodySchema = z.looseObject({
  resourceSpans: z
    .array(
      z.looseObject({
        resource: z.looseObject({ attributes }).optional(),
        scopeSpans: z.array(z.looseObject({ spans: z.array(span).max(5000).optional() })).optional(),
      }),
    )
    .optional(),
});
export type OpenRouterBody = z.infer<typeof openrouterBodySchema>;

/** Decodes an OTLP AnyValue into a plain JS value. */
export function otlpValue(v: OtlpValue | undefined): unknown {
  if (!v) return undefined;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(otlpValue);
  return undefined;
}

function attrMap(list: Span["attributes"]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const a of list ?? []) m.set(a.key, otlpValue(a.value));
  return m;
}

const A = {
  requestModel: "gen_ai.request.model",
  responseModel: "gen_ai.response.model",
  responseId: "gen_ai.response.id",
  system: "gen_ai.system",
  providerName: "gen_ai.provider.name",
  inputTokens: "gen_ai.usage.input_tokens",
  promptTokens: "gen_ai.usage.prompt_tokens",
  outputTokens: "gen_ai.usage.output_tokens",
  completionTokens: "gen_ai.usage.completion_tokens",
  cacheWrite: "gen_ai.usage.input_tokens.cache_write",
  cacheWriteMeta: "span.metadata.openrouter_generation.cache_write_tokens",
  totalCost: "gen_ai.usage.total_cost",
  userId: "user.id",
  sessionId: "session.id",
} as const;
const TRACE_META = "trace.metadata.";

const hasUsage = (a: Map<string, unknown>) =>
  [A.inputTokens, A.promptTokens, A.outputTokens, A.completionTokens].some((k) => a.has(k));

const nanosToDate = (v: string | number | undefined) => {
  if (v === undefined || !/^\d+$/.test(String(v))) return undefined;
  const ms = Number(BigInt(String(v)) / 1_000_000n);
  return ms > 0 ? new Date(ms) : undefined;
};

function tagsFrom(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === "string");
  if (typeof v === "string") return v.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * One event per generation span (a span carrying `gen_ai.usage.*` token counts). Custom
 * `trace.metadata.*`, `user.id` and `session.id` are merged from every span of the same trace,
 * so attribution works whether OpenRouter puts them on the root or the generation span.
 * `gen_ai.usage.input_tokens` includes cache writes, which are subtracted from uncached input.
 * Cache reads have no documented OTLP attribute, so they are priced as regular input.
 */
export function mapOpenRouter(body: OpenRouterBody, query: QueryDefaults = {}): MapResult {
  const spans: { span: Span; attrs: Map<string, unknown> }[] = [];
  for (const rs of body.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) for (const s of ss.spans ?? []) spans.push({ span: s, attrs: attrMap(s.attributes) });
  }

  const traceAttrs = new Map<string, Map<string, unknown>>();
  for (const { span: s, attrs } of spans) {
    const t = traceAttrs.get(s.traceId ?? "") ?? new Map<string, unknown>();
    for (const [k, v] of attrs) if ((k.startsWith(TRACE_META) || k === A.userId || k === A.sessionId) && !t.has(k)) t.set(k, v);
    traceAttrs.set(s.traceId ?? "", t);
  }

  const events: UsageEventInput[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const { span: s, attrs } of spans) {
    if (!hasUsage(attrs)) continue;
    const rawModel = attrs.get(A.responseModel) ?? attrs.get(A.requestModel);
    const requestId = String(attrs.get(A.responseId) ?? `${s.traceId ?? ""}:${s.spanId ?? ""}`).slice(0, 200);
    if (typeof rawModel !== "string" || !rawModel || seen.has(requestId)) {
      skipped++;
      continue;
    }
    seen.add(requestId);

    const merged = new Map([...(traceAttrs.get(s.traceId ?? "") ?? []), ...attrs]);
    const meta: Record<string, unknown> = {};
    for (const [k, v] of merged) if (k.startsWith(TRACE_META)) meta[k.slice(TRACE_META.length)] = v;
    const tags = tagsFrom(meta.tags);
    const userId = typeof merged.get(A.userId) === "string" ? (merged.get(A.userId) as string) : undefined;

    const { provider, model } = resolveModel(rawModel);
    const input = int(attrs.get(A.inputTokens) ?? attrs.get(A.promptTokens));
    const cacheWrite = int(attrs.get(A.cacheWrite) ?? attrs.get(A.cacheWriteMeta));
    const start = nanosToDate(s.startTimeUnixNano);
    const end = nanosToDate(s.endTimeUnixNano);

    events.push({
      ts: start,
      provider,
      model: model.slice(0, 200),
      requestId,
      ...resolveAttribution({ metadata: [meta], tags, query, fallbackClient: [userId] }),
      endUser: userId?.slice(0, 200),
      inputTokens: Math.max(0, input - cacheWrite),
      outputTokens: int(attrs.get(A.outputTokens) ?? attrs.get(A.completionTokens)),
      cacheReadTokens: 0,
      cacheWriteTokens: cacheWrite,
      latencyMs: start && end && end >= start ? end.getTime() - start.getTime() : undefined,
      metadata: compact({
        integration: "openrouter",
        reportedCostUsd: num(attrs.get(A.totalCost)),
        openrouterModel: rawModel,
        upstreamProvider: attrs.get(A.providerName) ?? attrs.get(A.system),
        traceId: s.traceId,
        sessionId: merged.get(A.sessionId),
        apiKeyName: meta["openrouter.api_key_name"],
        tags: tags.length ? tags : undefined,
      }),
    });
  }
  return { events, skipped };
}
