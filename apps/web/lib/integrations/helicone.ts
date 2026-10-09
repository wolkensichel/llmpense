/**
 * Helicone webhooks. One POST per request; with "Include Data" enabled the payload carries
 * model, provider and a usage summary in `metadata`. Signed with HMAC-SHA256 over the JSON body
 * in the `helicone-signature` header (hex).
 * Spec: https://docs.helicone.ai/features/webhooks
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { UsageEventInput } from "@llmpense/core";
import { compact, int, num, resolveAttribution, resolveModel, type MapResult, type QueryDefaults } from "./common.ts";

export const HELICONE_SIGNATURE_HEADER = "helicone-signature";
export const HELICONE_SECRET_ENV = "HELICONE_WEBHOOK_SECRET";

export const heliconePayloadSchema = z.looseObject({
  request_id: z.string().min(1),
  user_id: z.string().nullish(),
  model: z.string().nullish(),
  provider: z.string().nullish(),
  metadata: z
    .looseObject({
      cost: z.number().nullish(),
      promptTokens: z.number().nonnegative().nullish(),
      completionTokens: z.number().nonnegative().nullish(),
      totalTokens: z.number().nullish(),
      latencyMs: z.number().nullish(),
    })
    .nullish(),
});
export type HeliconePayload = z.infer<typeof heliconePayloadSchema>;

export const heliconeBodySchema = z.union([heliconePayloadSchema, z.array(heliconePayloadSchema).min(1).max(1000)]);

const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Verifies `helicone-signature`. Helicone signs `JSON.stringify(payload)`; the raw body is checked
 * first, then the re-serialised parsed body in case a proxy reformatted whitespace.
 */
export function verifyHeliconeSignature(secret: string, rawBody: string, parsed: unknown, signature: string | null): boolean {
  if (!signature || !/^[0-9a-f]+$/i.test(signature.trim())) return false;
  const sig = signature.trim().toLowerCase();
  if (safeEqualHex(hmacHex(secret, rawBody), sig)) return true;
  return parsed !== undefined && safeEqualHex(hmacHex(secret, JSON.stringify(parsed)), sig);
}

/**
 * The webhook payload has no cache breakdown, so all prompt tokens count as uncached input.
 * Payloads without a model or usage (webhooks without "Include Data") are skipped.
 */
export function mapHelicone(items: HeliconePayload[], query: QueryDefaults = {}): MapResult {
  const events: UsageEventInput[] = [];
  let skipped = 0;
  for (const p of items) {
    const m = p.metadata;
    if (!p.model || !m) {
      skipped++;
      continue;
    }
    const { provider, model } = resolveModel(p.model, p.provider);
    const endUser = p.user_id || undefined;
    const latency = num(m.latencyMs);
    events.push({
      provider,
      model: model.slice(0, 200),
      requestId: p.request_id.slice(0, 200),
      ...resolveAttribution({ metadata: [], tags: [], query, fallbackClient: [endUser] }),
      endUser: endUser?.slice(0, 200),
      inputTokens: int(m.promptTokens),
      outputTokens: int(m.completionTokens),
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: latency !== undefined && latency >= 0 ? Math.round(latency) : undefined,
      metadata: compact({ integration: "helicone", reportedCostUsd: num(m.cost), heliconeProvider: p.provider }),
    });
  }
  return { events, skipped };
}
