/**
 * LiteLLM `generic_api` logging callback. LiteLLM POSTs a list of StandardLoggingPayload
 * objects (`log_format: json_array`, the default), one object per request (`single`) or
 * newline-delimited objects (`ndjson`).
 * Spec: https://docs.litellm.ai/docs/proxy/logging_spec
 */
import { z } from "zod";
import type { UsageEventInput } from "@llmpense/core";
import {
  compact,
  int,
  num,
  providerFromApiBase,
  resolveAttribution,
  resolveModel,
  type MapResult,
  type QueryDefaults,
} from "./common.ts";

const opt = <T extends z.ZodType>(t: T) => t.nullish();
const record = z.record(z.string(), z.unknown());

const usageObject = z.looseObject({
  prompt_tokens: opt(z.number()),
  completion_tokens: opt(z.number()),
  prompt_tokens_details: opt(z.looseObject({ cached_tokens: opt(z.number()) })),
  cache_creation_input_tokens: opt(z.number()),
  cache_read_input_tokens: opt(z.number()),
});

export const litellmPayloadSchema = z.looseObject({
  id: z.string().min(1),
  trace_id: opt(z.string()),
  session_id: opt(z.string()),
  call_type: opt(z.string()),
  status: opt(z.string()),
  response_cost: opt(z.number()),
  prompt_tokens: opt(z.number().nonnegative()),
  completion_tokens: opt(z.number().nonnegative()),
  total_tokens: opt(z.number()),
  startTime: opt(z.number()),
  endTime: opt(z.number()),
  model: z.string().min(1),
  model_id: opt(z.string()),
  model_group: opt(z.string()),
  api_base: opt(z.string()),
  custom_llm_provider: opt(z.string()),
  model_map_information: opt(z.looseObject({ model_map_key: opt(z.string()) })),
  cache_hit: opt(z.boolean()),
  request_tags: opt(z.array(z.unknown())),
  end_user: opt(z.string()),
  metadata: opt(
    z.looseObject({
      user_api_key_alias: opt(z.string()),
      user_api_key_team_id: opt(z.string()),
      user_api_key_team_alias: opt(z.string()),
      user_api_key_user_id: opt(z.string()),
      user_api_key_end_user_id: opt(z.string()),
      spend_logs_metadata: opt(record),
      requester_metadata: opt(record),
      usage_object: opt(usageObject),
    }),
  ),
  hidden_params: opt(z.looseObject({ litellm_model_name: opt(z.string()), api_base: opt(z.string()) })),
  error_information: opt(z.looseObject({ llm_provider: opt(z.string()) })),
});
export type LiteLLMPayload = z.infer<typeof litellmPayloadSchema>;

export const litellmBodySchema = z.union([litellmPayloadSchema, z.array(litellmPayloadSchema).min(1).max(1000)]);

/**
 * Token buckets. LiteLLM's `prompt_tokens` includes cache reads (`prompt_tokens_details.cached_tokens`)
 * but not Anthropic cache writes (`cache_creation_input_tokens`), so uncached input is
 * `prompt_tokens - cached_tokens`.
 */
export function litellmTokens(p: LiteLLMPayload) {
  const usage = p.metadata?.usage_object;
  const prompt = int(p.prompt_tokens ?? usage?.prompt_tokens);
  const cacheRead = int(usage?.prompt_tokens_details?.cached_tokens ?? usage?.cache_read_input_tokens);
  const cacheWrite = int(usage?.cache_creation_input_tokens);
  return {
    inputTokens: Math.max(0, prompt - cacheRead),
    outputTokens: int(p.completion_tokens ?? usage?.completion_tokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

const tagList = (tags: unknown[] | null | undefined) => (tags ?? []).filter((t): t is string => typeof t === "string");

export function mapLiteLLM(items: LiteLLMPayload[], query: QueryDefaults = {}): MapResult {
  const events: UsageEventInput[] = [];
  let skipped = 0;
  for (const p of items) {
    if (p.status === "failure") {
      skipped++;
      continue;
    }
    const meta = p.metadata ?? {};
    const tags = tagList(p.request_tags);
    const rawModel = p.hidden_params?.litellm_model_name || p.model;
    const { provider, model } = resolveModel(
      rawModel,
      p.custom_llm_provider,
      p.model_map_information?.model_map_key?.split("/")[0],
      p.model.includes("/") ? p.model.split("/")[0] : null,
      providerFromApiBase(p.api_base ?? p.hidden_params?.api_base),
      p.error_information?.llm_provider,
    );
    const endUser = p.end_user || meta.user_api_key_end_user_id || undefined;
    const attribution = resolveAttribution({
      metadata: [meta.requester_metadata, meta.spend_logs_metadata, meta],
      tags,
      query,
      fallbackClient: [meta.user_api_key_team_alias, endUser],
    });
    const start = num(p.startTime);
    const end = num(p.endTime);
    const latency = start !== undefined && end !== undefined && end >= start ? Math.round((end - start) * 1000) : undefined;

    events.push({
      ts: start !== undefined ? new Date(start * 1000) : undefined,
      provider,
      model: model.slice(0, 200),
      requestId: p.id.slice(0, 200),
      ...attribution,
      endUser: endUser?.slice(0, 200),
      ...litellmTokens(p),
      // A LiteLLM cache hit is answered without calling the provider.
      costUsd: p.cache_hit ? 0 : undefined,
      latencyMs: latency,
      outcome: p.cache_hit ? "cache_hit" : undefined,
      metadata: compact({
        integration: "litellm",
        reportedCostUsd: num(p.response_cost),
        modelGroup: p.model_group,
        keyAlias: meta.user_api_key_alias,
        teamId: meta.user_api_key_team_id,
        teamAlias: meta.user_api_key_team_alias,
        traceId: p.trace_id,
        sessionId: p.session_id,
        callType: p.call_type,
        tags: tags.length ? tags : undefined,
      }),
    });
  }
  return { events, skipped };
}

/** Parses a json_array, single or ndjson body. Returns undefined when the body is not JSON. */
export function parseLiteLLMBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) return undefined;
    try {
      return lines.map((l) => JSON.parse(l) as unknown).flatMap((v) => (Array.isArray(v) ? v : [v]));
    } catch {
      return undefined;
    }
  }
}
