import { PROVIDERS, type Provider, type UsageEventInput } from "@llmpense/core";

export const INTEGRATIONS = ["litellm", "helicone", "openrouter"] as const;
export type Integration = (typeof INTEGRATIONS)[number];

/** Attribution keys read from a tool's request metadata. */
export const META_KEYS = { client: "llmpense_client", project: "llmpense_project", feature: "llmpense_feature" } as const;

/** Provider names used by gateways, mapped to LLMpense providers. Keys are lowercase. */
const PROVIDER_ALIASES: Record<string, Provider> = {
  openai: "openai",
  "text-completion-openai": "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  google: "gemini",
  "google-ai-studio": "gemini",
  "google ai studio": "gemini",
  azure: "azure",
  azure_ai: "azure",
  "azure openai": "azure",
  bedrock: "bedrock",
  bedrock_converse: "bedrock",
  "amazon bedrock": "bedrock",
  "amazon-bedrock": "bedrock",
  aws: "bedrock",
  vertex: "vertex",
  vertex_ai: "vertex",
  vertex_ai_beta: "vertex",
  "google vertex": "vertex",
  "google-vertex": "vertex",
};

/** Maps a gateway's provider name to the PROVIDERS enum; null when unknown. */
export function normalizeProvider(name: string | null | undefined): Provider | null {
  if (!name) return null;
  const k = name.trim().toLowerCase();
  if (PROVIDER_ALIASES[k]) return PROVIDER_ALIASES[k];
  return (PROVIDERS as readonly string[]).includes(k) ? (k as Provider) : null;
}

/** Guesses the provider from a bare model id. */
export function providerFromModel(model: string): Provider | null {
  const m = model.trim().toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gemini")) return "gemini";
  if (/^(gpt-|chatgpt|o\d(\b|-)|text-|davinci|codex)/.test(m)) return "openai";
  return null;
}

/** Route segments some gateways put between the provider prefix and the model id. */
const ROUTE_SEGMENTS = new Set(["converse", "invoke", "chat", "models"]);

/**
 * Splits `provider/model` ids such as `anthropic/claude-sonnet-4-5` or `vertex_ai/gemini-2.5-flash`.
 * Returns the recognised provider (if any) and the model id without routing prefixes.
 */
export function splitModel(raw: string): { provider: Provider | null; model: string } {
  const parts = raw.trim().split("/");
  let provider: Provider | null = null;
  if (parts.length > 1) {
    provider = normalizeProvider(parts[0]);
    if (provider) parts.shift();
    while (parts.length > 1 && ROUTE_SEGMENTS.has(parts[0]!.toLowerCase())) parts.shift();
  }
  return { provider, model: parts.join("/") };
}

/**
 * Cleans a model id for price lookup: drops OpenRouter variant suffixes (`:free`, `:nitro`)
 * and writes Anthropic model versions with hyphens (`claude-sonnet-4.5` -> `claude-sonnet-4-5`).
 */
export function cleanModel(provider: Provider, model: string): string {
  let m = model.trim().replace(/:[a-z]+$/i, "");
  if (provider === "anthropic" && /^claude-/i.test(m)) m = m.replace(/(\d)\.(\d)/g, "$1-$2");
  return m;
}

/** Resolves provider and model from a gateway's model id plus optional provider hints (first match wins). */
export function resolveModel(rawModel: string, ...hints: (string | null | undefined)[]): { provider: Provider; model: string } {
  const { provider: fromPrefix, model } = splitModel(rawModel);
  let provider = fromPrefix;
  for (const h of hints) {
    if (provider) break;
    provider = normalizeProvider(h);
  }
  provider ??= providerFromModel(model) ?? "other";
  return { provider, model: cleanModel(provider, model) || rawModel };
}

/** Provider from a known API host, for gateways that only report the base URL. */
export function providerFromApiBase(apiBase: string | null | undefined): Provider | null {
  if (!apiBase) return null;
  let host: string;
  try {
    host = new URL(apiBase).hostname;
  } catch {
    return null;
  }
  if (host.endsWith("openai.azure.com") || host.endsWith("services.ai.azure.com")) return "azure";
  if (host === "api.openai.com") return "openai";
  if (host === "api.anthropic.com") return "anthropic";
  if (host === "generativelanguage.googleapis.com") return "gemini";
  if (host.endsWith("aiplatform.googleapis.com")) return "vertex";
  if (host.startsWith("bedrock") && host.endsWith("amazonaws.com")) return "bedrock";
  return null;
}

export interface QueryDefaults {
  client?: string;
  project?: string;
  feature?: string;
}

export interface AttributionInput {
  /** Metadata objects in priority order; the first one holding a key wins. */
  metadata: (Record<string, unknown> | null | undefined)[];
  tags: string[];
  /** `?client=&project=&feature=` from the endpoint URL. */
  query: QueryDefaults;
  /** The tool's team / end-user fields, in priority order. Used for the client only. */
  fallbackClient: (string | null | undefined)[];
}

export interface Attribution {
  client?: string;
  project?: string;
  feature?: string;
}

const str = (v: unknown, max = 100): string | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
};

/** Reads `client:<slug>` style tags. */
function fromTags(tags: string[], name: string): string | undefined {
  const prefix = `${name}:`;
  for (const t of tags) {
    if (typeof t === "string" && t.toLowerCase().startsWith(prefix)) {
      const v = str(t.slice(prefix.length));
      if (v) return v;
    }
  }
  return undefined;
}

function fromMeta(metadata: AttributionInput["metadata"], key: string): string | undefined {
  for (const m of metadata) {
    const v = m ? str(m[key]) : undefined;
    if (v) return v;
  }
  return undefined;
}

/**
 * Attribution precedence, per field:
 * 1. metadata key (`llmpense_client`, `llmpense_project`, `llmpense_feature`)
 * 2. tag (`client:<slug>`, `project:<slug>`, `feature:<slug>`)
 * 3. endpoint query parameter (`?client=`, `?project=`, `?feature=`)
 * 4. client only: the tool's team / end-user field
 * Anything left unset falls back to the API key's default client and project when stored.
 */
export function resolveAttribution(input: AttributionInput): Attribution {
  const pick = (field: keyof typeof META_KEYS) =>
    fromMeta(input.metadata, META_KEYS[field]) ?? fromTags(input.tags, field) ?? str(input.query[field]);
  const client = pick("client") ?? input.fallbackClient.map((v) => str(v)).find(Boolean);
  const out: Attribution = {};
  if (client) out.client = client;
  const project = pick("project");
  if (project) out.project = project;
  const feature = pick("feature");
  if (feature) out.feature = feature;
  return out;
}

export function queryDefaults(url: URL): QueryDefaults {
  const q: QueryDefaults = {};
  for (const k of ["client", "project", "feature"] as const) {
    const v = url.searchParams.get(k)?.trim();
    if (v) q[k] = v.slice(0, 100);
  }
  return q;
}

/** Non-negative integer from a number or numeric string; 0 otherwise. */
export function int(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Finite number or undefined. */
export function num(v: unknown): number | undefined {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Drops undefined/null values so stored metadata stays compact. */
export function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));
}

export interface MapResult {
  events: UsageEventInput[];
  /** Items that carried no billable usage (failures, test pings). */
  skipped: number;
}
