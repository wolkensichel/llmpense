import type { Provider } from "../../events.ts";
import { cacheRate, fetchJson, isRecord, normalizeModelId, perTokenToPerM } from "../normalize.ts";
import type { NormalizedRow, SourceAdapter, SourceRows } from "../types.ts";

const URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const PROVIDERS: Record<string, Provider> = { openai: "openai", anthropic: "anthropic", gemini: "gemini" };

/** LiteLLM `model_prices_and_context_window.json`: USD per token, keyed by model id. */
export function parseLiteLLM(raw: unknown): SourceRows {
  if (!isRecord(raw)) throw new Error("litellm: expected an object");
  const rows: NormalizedRow[] = [];
  const seen = new Set<string>();
  for (const [name, e] of Object.entries(raw)) {
    if (!isRecord(e) || e.mode !== "chat") continue;
    const provider = PROVIDERS[String(e.litellm_provider)];
    if (!provider) continue;
    const input = perTokenToPerM(e.input_cost_per_token);
    const output = perTokenToPerM(e.output_cost_per_token);
    if (input === null || output === null) continue;
    const model = normalizeModelId(name);
    const key = `${provider}/${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      provider,
      model,
      inputPerMTok: input,
      outputPerMTok: output,
      cacheReadPerMTok: cacheRate(perTokenToPerM(e.cache_read_input_token_cost)),
      cacheWritePerMTok: cacheRate(perTokenToPerM(e.cache_creation_input_token_cost)),
    });
  }
  return { rows };
}

export const litellm: SourceAdapter = {
  name: "litellm",
  url: URL,
  license: "MIT",
  copyright: "Copyright (c) 2023 Berri AI",
  fetch: (signal) => fetchJson(URL, signal),
  parse: (raw) => parseLiteLLM(raw),
};
