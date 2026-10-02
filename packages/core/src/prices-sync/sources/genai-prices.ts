import type { Provider } from "../../events.ts";
import { cacheRate, fetchJson, isRecord, isTextChatModel, normalizeModelId, num } from "../normalize.ts";
import type { NormalizedRow, SourceAdapter, SourceRows } from "../types.ts";

const URL = "https://raw.githubusercontent.com/pydantic/genai-prices/main/prices/new_data/v2/data_slim.json";
const PROVIDERS: Record<string, Provider> = { openai: "openai", anthropic: "anthropic", google: "gemini" };

type Clause = Record<string, unknown>;

/** Evaluates a genai-prices `match` clause (equals/starts_with/ends_with/contains/regex/or/and). */
export function matches(clause: unknown, id: string): boolean {
  if (!isRecord(clause)) return false;
  const c = clause as Clause;
  if (typeof c.equals === "string") return id === c.equals;
  if (typeof c.starts_with === "string") return id.startsWith(c.starts_with);
  if (typeof c.ends_with === "string") return id.endsWith(c.ends_with);
  if (typeof c.contains === "string") return id.includes(c.contains);
  if (typeof c.regex === "string") {
    try {
      return new RegExp(c.regex).test(id);
    } catch {
      return false;
    }
  }
  if (Array.isArray(c.or)) return c.or.some((x) => matches(x, id));
  if (Array.isArray(c.and)) return c.and.every((x) => matches(x, id));
  return false;
}

/** Exact ids a match clause names via top-level `equals` (alone or inside `or`). */
function equalsAliases(clause: unknown): string[] {
  if (!isRecord(clause)) return [];
  if (typeof clause.equals === "string") return [clause.equals];
  if (Array.isArray(clause.or)) return clause.or.flatMap((x) => (isRecord(x) && typeof x.equals === "string" ? [x.equals] : []));
  return [];
}

/** Tiered prices `{base, tiers}` -> base (the <= threshold rate). */
function rate(v: unknown): number | null {
  if (isRecord(v)) return num(v.base);
  return num(v);
}

/** Picks the price set in effect at `now` from a plain object or a dated list. */
export function currentPrices(prices: unknown, now: Date): Record<string, unknown> | undefined {
  if (isRecord(prices)) return prices;
  if (!Array.isArray(prices)) return undefined;
  const today = now.toISOString().slice(0, 10);
  let chosen: Record<string, unknown> | undefined;
  for (const entry of prices) {
    if (!isRecord(entry) || !isRecord(entry.prices)) continue;
    const constraint = entry.constraint;
    if (constraint !== undefined) {
      if (!isRecord(constraint)) continue;
      // Only date constraints are understood; skip time-of-day or other conditions.
      if (Object.keys(constraint).some((k) => k !== "start_date")) continue;
      if (typeof constraint.start_date !== "string" || constraint.start_date > today) continue;
    }
    chosen = entry.prices;
  }
  return chosen;
}

/** pydantic/genai-prices v2 slim data: list of providers, prices already per million tokens. */
export function parseGenaiPrices(raw: unknown, now: Date): SourceRows {
  if (!Array.isArray(raw)) throw new Error("genai-prices: expected an array of providers");
  const rows: NormalizedRow[] = [];
  const seen = new Set<string>();
  const matchers: { provider: Provider; match: unknown; row: NormalizedRow }[] = [];

  for (const p of raw) {
    if (!isRecord(p) || !Array.isArray(p.models)) continue;
    const provider = PROVIDERS[String(p.id)];
    if (!provider) continue;
    for (const m of p.models) {
      if (!isRecord(m) || typeof m.id !== "string") continue;
      const id = normalizeModelId(m.id);
      if (!isTextChatModel(provider, id)) continue;
      const pr = currentPrices(m.prices, now);
      if (!pr) continue;
      const input = rate(pr.input_mtok);
      const output = rate(pr.output_mtok);
      if (input === null || output === null) continue;
      const base = { provider, inputPerMTok: input, outputPerMTok: output, cacheReadPerMTok: cacheRate(rate(pr.cache_read_mtok)), cacheWritePerMTok: cacheRate(rate(pr.cache_write_mtok)) };
      matchers.push({ provider, match: m.match, row: { ...base, model: id } });
      // Exact aliases that extend the canonical id (dated snapshots, -chat-latest); other
      // aliases (e.g. OpenRouter-style "gpt-5-5") are left to `resolve`.
      const aliases = equalsAliases(m.match).map(normalizeModelId).filter((a) => a.startsWith(id));
      for (const alias of [id, ...aliases]) {
        const key = `${provider}/${alias}`;
        if (seen.has(key) || !isTextChatModel(provider, alias)) continue;
        seen.add(key);
        rows.push({ ...base, model: alias });
      }
    }
  }

  const resolve = (provider: Provider, model: string): NormalizedRow | undefined => {
    const id = model.toLowerCase();
    const hit = matchers.find((x) => x.provider === provider && matches(x.match, id));
    return hit ? { ...hit.row, model } : undefined;
  };
  return { rows, resolve };
}

export const genaiPrices: SourceAdapter = {
  name: "genai-prices",
  url: URL,
  license: "MIT",
  copyright: "Copyright (c) Pydantic Services Inc. 2025 to present",
  fetch: (signal) => fetchJson(URL, signal),
  parse: (raw, now) => parseGenaiPrices(raw, now),
};
