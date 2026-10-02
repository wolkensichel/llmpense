import type { Provider } from "../events.ts";

/** Rounds to 6 decimals to remove float noise from unit conversions. */
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** USD per token -> USD per million tokens. */
export function perTokenToPerM(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? round6(v * 1e6) : null;
}

/** Number or null, rounded. */
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? round6(v) : null;
}

/**
 * Cache rate: a stated 0 is treated as "not stated". No first-party provider charges
 * 0 for cache reads/writes on a model that supports caching; databases use 0 as filler.
 */
export function cacheRate(v: number | null): number | null {
  return v === 0 ? null : v;
}

/** Strips routing prefixes like `gemini/` or `models/` and lowercases. */
export function normalizeModelId(id: string): string {
  return id.trim().toLowerCase().replace(/^(gemini|models|google|openai|anthropic)\//, "");
}

/**
 * Name-based filter for sources without a reliable "mode" field: drops embeddings,
 * speech, image/video generation, realtime/live, moderation, fine-tune templates and
 * legacy completion models. Only chat/text models remain.
 */
const NON_TEXT =
  /(embed|tts|transcri|whisper|dall-e|image|imagen|sora|veo|lyria|moderation|realtime|audio|live|robotics|computer-use|deep-research|search|davinci|babbage|curie|^ada\b|^ada-|diarize)/;

export function isTextChatModel(provider: Provider, model: string): boolean {
  if (model.includes(":") || model.includes("/") || model.endsWith("-") || model === "default") return false;
  if (NON_TEXT.test(model)) return false;
  if (provider === "anthropic") return model.startsWith("claude-");
  if (provider === "gemini") return model.startsWith("gemini-");
  // Open-weight gpt-oss is served by third parties, not the OpenAI API.
  return !model.startsWith("gpt-oss");
}

/** fetch + JSON with a hard timeout. */
export async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
