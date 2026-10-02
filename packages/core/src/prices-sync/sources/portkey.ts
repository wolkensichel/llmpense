import type { Provider } from "../../events.ts";
import { cacheRate, fetchJson, isRecord, isTextChatModel, normalizeModelId, round6 } from "../normalize.ts";
import type { NormalizedRow, SourceAdapter, SourceRows } from "../types.ts";

/**
 * Raw files from the MIT-licensed Portkey-AI/models repo.
 */
const BASE = "https://raw.githubusercontent.com/Portkey-AI/models/main/pricing";
const FILES: Record<string, Provider> = { openai: "openai", anthropic: "anthropic", google: "gemini" };

/** Portkey prices are US cents per token: x 1e6 / 100 = USD per million. */
function centsPerTokenToPerM(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? round6(v * 1e4) : null;
}

function price(payg: Record<string, unknown>, key: string): number | null {
  const v = payg[key];
  return isRecord(v) ? centsPerTokenToPerM(v.price) : null;
}

/** Portkey's Google file splits long-context rates into `-lte-128k` / `-gt-128k` entries. */
const LTE = /-lte-\d+k$/;
const GT = /-gt-\d+k$/;

/** `raw` = `{openai: <pricing/openai.json>, anthropic: ..., google: ...}`. */
export function parsePortkey(raw: unknown): SourceRows {
  if (!isRecord(raw)) throw new Error("portkey: expected an object");
  const rows: NormalizedRow[] = [];
  const seen = new Set<string>();
  for (const [file, provider] of Object.entries(FILES)) {
    const data = raw[file];
    if (!isRecord(data)) continue;
    for (const [key, entry] of Object.entries(data)) {
      if (GT.test(key)) continue;
      const model = normalizeModelId(key.replace(LTE, ""));
      if (!isTextChatModel(provider, model)) continue;
      const cfg = isRecord(entry) ? entry.pricing_config : undefined;
      const payg = isRecord(cfg) ? cfg.pay_as_you_go : undefined;
      if (!isRecord(payg)) continue;
      const input = price(payg, "request_token");
      const output = price(payg, "response_token");
      if (input === null || output === null || (input === 0 && output === 0)) continue;
      const id = `${provider}/${model}`;
      if (seen.has(id)) continue;
      seen.add(id);
      // Portkey fills unknown cache rates with 0; treat 0 as "not stated" so it never
      // undercuts a real rate from another source.
      const cacheRead = price(payg, "cache_read_input_token");
      const cacheWrite = price(payg, "cache_write_input_token");
      rows.push({
        provider,
        model,
        inputPerMTok: input,
        outputPerMTok: output,
        cacheReadPerMTok: cacheRate(cacheRead),
        cacheWritePerMTok: cacheRate(cacheWrite),
      });
    }
  }
  return { rows };
}

export const portkey: SourceAdapter = {
  name: "portkey",
  url: `${BASE}/{openai,anthropic,google}.json`,
  license: "MIT",
  copyright: "Copyright (c) 2025 Portkey.ai",
  async fetch(signal) {
    const entries = await Promise.all(
      Object.keys(FILES).map(async (f) => [f, await fetchJson(`${BASE}/${f}.json`, signal)] as const),
    );
    return Object.fromEntries(entries);
  },
  parse: (raw) => parsePortkey(raw),
};
