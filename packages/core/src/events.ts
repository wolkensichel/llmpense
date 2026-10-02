import { z } from "zod";

export const PROVIDERS = ["openai", "anthropic", "gemini", "azure", "bedrock", "vertex", "other"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * Normalized token counts. Providers count input differently:
 * - Anthropic `input_tokens` already excludes cache reads/writes.
 * - OpenAI `prompt_tokens` includes `cached_tokens`.
 * We store `inputTokens` as UNCACHED input only, so cost = sum of each bucket * its rate.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const usageEventInputSchema = z.object({
  ts: z.coerce.date().optional(),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1).max(200),
  requestId: z.string().max(200).optional(),
  client: z.string().max(100).optional().describe("Client slug"),
  project: z.string().max(100).optional().describe("Project slug within the client"),
  feature: z.string().max(100).optional(),
  endUser: z.string().max(200).optional(),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  /** Overrides computed cost, e.g. for self-hosted models with a known unit cost. */
  costUsd: z.number().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  status: z.number().int().optional(),
  outcome: z.string().max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UsageEventInput = z.infer<typeof usageEventInputSchema>;

export const ingestBatchSchema = z.object({
  events: z.array(usageEventInputSchema).min(1).max(1000),
});
