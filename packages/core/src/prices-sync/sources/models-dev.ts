import type { Provider } from "../../events.ts";
import { cacheRate, fetchJson, isRecord, isTextChatModel, normalizeModelId, num } from "../normalize.ts";
import type { NormalizedRow, SourceAdapter, SourceRows } from "../types.ts";

/** Generated from the MIT-licensed TOML files in the anomalyco/models.dev (formerly sst) repo. */
const URL = "https://models.dev/api.json";
const PROVIDERS: Record<string, Provider> = { openai: "openai", anthropic: "anthropic", google: "gemini" };

/** models.dev api.json: `{providerId: {models: {modelId: {cost: {input, output, cache_read, cache_write}}}}}`, USD per million. */
export function parseModelsDev(raw: unknown): SourceRows {
  if (!isRecord(raw)) throw new Error("models.dev: expected an object");
  const rows: NormalizedRow[] = [];
  for (const [pid, provider] of Object.entries(PROVIDERS)) {
    const p = raw[pid];
    if (!isRecord(p) || !isRecord(p.models)) continue;
    for (const [key, m] of Object.entries(p.models)) {
      if (!isRecord(m) || !isRecord(m.cost)) continue;
      const model = normalizeModelId(typeof m.id === "string" ? m.id : key);
      if (!isTextChatModel(provider, model)) continue;
      const out = isRecord(m.modalities) ? m.modalities.output : undefined;
      if (Array.isArray(out) && (out.length !== 1 || out[0] !== "text")) continue;
      const input = num(m.cost.input);
      const output = num(m.cost.output);
      if (input === null || output === null) continue;
      rows.push({
        provider,
        model,
        inputPerMTok: input,
        outputPerMTok: output,
        cacheReadPerMTok: cacheRate(num(m.cost.cache_read)),
        cacheWritePerMTok: cacheRate(num(m.cost.cache_write)),
      });
    }
  }
  return { rows };
}

export const modelsDev: SourceAdapter = {
  name: "models.dev",
  url: URL,
  license: "MIT",
  copyright: "Copyright (c) 2025 models.dev",
  fetch: (signal) => fetchJson(URL, signal),
  parse: (raw) => parseModelsDev(raw),
};
