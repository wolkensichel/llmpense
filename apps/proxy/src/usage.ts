/**
 * Pure usage extraction: provider response bodies (JSON or SSE) -> core's normalized
 * TokenUsage. No I/O here; everything is unit-tested in test/usage.test.ts.
 *
 * Normalization rule (see TokenUsage in @llmpense/core): `inputTokens` is UNCACHED input.
 * OpenAI counts cached tokens inside `prompt_tokens` / `input_tokens`, Anthropic does not.
 */
import type { TokenUsage } from "@llmpense/core";

export type UpstreamName = "openai" | "anthropic" | "gemini";

/** The response shapes we know how to meter. */
export type EndpointKind = "openai.chat" | "openai.responses" | "openai.embeddings" | "anthropic.messages";

export interface Extracted {
  usage: TokenUsage;
  model?: string;
  requestId?: string;
}

/** Which metered endpoint a request hits, or null if it is proxied without metering. */
export function classifyEndpoint(upstream: UpstreamName, method: string, path: string): EndpointKind | null {
  if (method.toUpperCase() !== "POST") return null;
  const p = path.replace(/\/+$/, "");
  if (upstream === "anthropic") return /\/messages$/.test(p) && !/\/batches\//.test(p) ? "anthropic.messages" : null;
  // OpenAI and Gemini's OpenAI-compatible endpoint (/v1beta/openai/...).
  if (p.endsWith("/chat/completions")) return "openai.chat";
  if (p.endsWith("/embeddings")) return "openai.embeddings";
  if (upstream === "openai" && p.endsWith("/responses")) return "openai.responses";
  return null;
}

// ---------------------------------------------------------------------------
// helpers

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Json | undefined => (isObj(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
/** Non-negative integer or undefined (null/missing/garbage). */
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

// ---------------------------------------------------------------------------
// usage objects

/** Chat Completions / Gemini OpenAI-compat / embeddings `usage`. */
export function openAIChatUsage(u: unknown): TokenUsage | null {
  const usage = obj(u);
  if (!usage) return null;
  const prompt = num(usage.prompt_tokens) ?? 0;
  const cached = Math.min(num(obj(usage.prompt_tokens_details)?.cached_tokens) ?? 0, prompt);
  return { ...ZERO, inputTokens: prompt - cached, cacheReadTokens: cached, outputTokens: num(usage.completion_tokens) ?? 0 };
}

/** Responses API `usage`. */
export function openAIResponsesUsage(u: unknown): TokenUsage | null {
  const usage = obj(u);
  if (!usage) return null;
  const input = num(usage.input_tokens) ?? 0;
  const cached = Math.min(num(obj(usage.input_tokens_details)?.cached_tokens) ?? 0, input);
  return { ...ZERO, inputTokens: input - cached, cacheReadTokens: cached, outputTokens: num(usage.output_tokens) ?? 0 };
}

/** Anthropic `usage` (input_tokens already excludes cache reads and writes). */
export function anthropicUsage(u: unknown): TokenUsage | null {
  const usage = obj(u);
  if (!usage) return null;
  return {
    inputTokens: num(usage.input_tokens) ?? 0,
    outputTokens: num(usage.output_tokens) ?? 0,
    cacheReadTokens: num(usage.cache_read_input_tokens) ?? 0,
    cacheWriteTokens: num(usage.cache_creation_input_tokens) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// non-streaming bodies

export function extractJson(kind: EndpointKind, body: unknown): Extracted | null {
  const b = obj(body);
  if (!b) return null;
  let usage: TokenUsage | null;
  switch (kind) {
    case "openai.chat":
    case "openai.embeddings":
      usage = openAIChatUsage(b.usage);
      break;
    case "openai.responses":
      usage = openAIResponsesUsage(b.usage);
      break;
    case "anthropic.messages":
      usage = anthropicUsage(b.usage);
      break;
  }
  if (!usage) return null;
  return { usage, model: str(b.model), requestId: str(b.id) };
}

// ---------------------------------------------------------------------------
// SSE

export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Incremental text/event-stream parser. Feed it decoded text in arbitrary pieces;
 * it returns every event completed so far. Handles CRLF/CR/LF, multi-line data and
 * events or line terminators split across chunks.
 */
export class SseParser {
  private buf = "";
  private data: string[] = [];
  private event: string | undefined;

  push(text: string): SseEvent[] {
    this.buf += text;
    const out: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A trailing CR might be the first half of CRLF; wait for the next chunk.
      if (ch === "\r" && i === this.buf.length - 1) break;
      this.line(this.buf.slice(start, i), out);
      if (ch === "\r" && this.buf[i + 1] === "\n") i++;
      start = i + 1;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** Call at end of stream: dispatches a final event that lacked a trailing blank line. */
  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buf.length > 0) this.line(this.buf.replace(/\r$/, ""), out);
    this.buf = "";
    this.line("", out);
    return out;
  }

  private line(line: string, out: SseEvent[]) {
    if (line === "") {
      if (this.data.length > 0) out.push({ event: this.event, data: this.data.join("\n") });
      this.data = [];
      this.event = undefined;
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
  }
}

/** Folds the events of one streamed response into its usage. */
export interface StreamAccumulator {
  onEvent(e: SseEvent): void;
  result(): Extracted | null;
}

function parseData(e: SseEvent): Json | undefined {
  if (e.data === "[DONE]") return undefined;
  try {
    return obj(JSON.parse(e.data));
  } catch {
    return undefined;
  }
}

/** Chat Completions chunks: usage arrives in the last chunk when include_usage is set. */
function openAIChatStream(): StreamAccumulator {
  let model: string | undefined;
  let id: string | undefined;
  let usage: TokenUsage | null = null;
  return {
    onEvent(e) {
      const d = parseData(e);
      if (!d) return;
      model ??= str(d.model);
      id ??= str(d.id);
      if (isObj(d.usage)) usage = openAIChatUsage(d.usage);
    },
    result: () => (usage ? { usage, model, requestId: id } : null),
  };
}

/** Responses API: usage is on the terminal event's `response`. */
function openAIResponsesStream(): StreamAccumulator {
  const TERMINAL = new Set(["response.completed", "response.incomplete", "response.failed"]);
  let model: string | undefined;
  let id: string | undefined;
  let usage: TokenUsage | null = null;
  return {
    onEvent(e) {
      const d = parseData(e);
      if (!d) return;
      const response = obj(d.response);
      if (response) {
        model = str(response.model) ?? model;
        id = str(response.id) ?? id;
      }
      const type = str(d.type) ?? e.event;
      if (type && TERMINAL.has(type) && response && isObj(response.usage)) usage = openAIResponsesUsage(response.usage);
    },
    result: () => (usage ? { usage, model, requestId: id } : null),
  };
}

/**
 * Anthropic Messages: `message_start` has input + cache counts, each `message_delta`
 * has the cumulative output count (and possibly updated input/cache counts).
 * Later non-null values win.
 */
function anthropicStream(): StreamAccumulator {
  let model: string | undefined;
  let id: string | undefined;
  let seen = false;
  const usage: TokenUsage = { ...ZERO };
  const merge = (u: unknown) => {
    const x = obj(u);
    if (!x) return;
    seen = true;
    usage.inputTokens = num(x.input_tokens) ?? usage.inputTokens;
    usage.outputTokens = num(x.output_tokens) ?? usage.outputTokens;
    usage.cacheReadTokens = num(x.cache_read_input_tokens) ?? usage.cacheReadTokens;
    usage.cacheWriteTokens = num(x.cache_creation_input_tokens) ?? usage.cacheWriteTokens;
  };
  return {
    onEvent(e) {
      const d = parseData(e);
      if (!d) return;
      const type = str(d.type) ?? e.event;
      if (type === "message_start") {
        const message = obj(d.message);
        model = str(message?.model) ?? model;
        id = str(message?.id) ?? id;
        merge(message?.usage);
      } else if (type === "message_delta") {
        merge(d.usage);
      }
    },
    result: () => (seen ? { usage: { ...usage }, model, requestId: id } : null),
  };
}

export function createStreamAccumulator(kind: EndpointKind): StreamAccumulator {
  switch (kind) {
    case "openai.chat":
    case "openai.embeddings":
      return openAIChatStream();
    case "openai.responses":
      return openAIResponsesStream();
    case "anthropic.messages":
      return anthropicStream();
  }
}

/** Convenience for tests and one-shot use: parse a complete SSE body. */
export function extractSse(kind: EndpointKind, chunks: string | string[]): Extracted | null {
  const parser = new SseParser();
  const acc = createStreamAccumulator(kind);
  for (const c of Array.isArray(chunks) ? chunks : [chunks]) for (const e of parser.push(c)) acc.onEvent(e);
  for (const e of parser.end()) acc.onEvent(e);
  return acc.result();
}

// ---------------------------------------------------------------------------
// byte-level collector used by the proxy's stream tap

/** Non-streamed bodies larger than this are passed through but not metered. */
export const MAX_JSON_BYTES = 32 * 1024 * 1024;

/**
 * Receives response bytes as they pass through the proxy and yields the usage at the
 * end. SSE is parsed incrementally (constant memory); JSON is accumulated (a copy, the
 * client already got the bytes) up to MAX_JSON_BYTES.
 */
export class UsageCollector {
  private decoder = new TextDecoder();
  private parser = new SseParser();
  private acc: StreamAccumulator;
  private chunks: Uint8Array[] = [];
  private size = 0;
  private overflow = false;

  constructor(
    private kind: EndpointKind,
    readonly sse: boolean,
  ) {
    this.acc = createStreamAccumulator(kind);
  }

  push(bytes: Uint8Array) {
    if (this.sse) {
      for (const e of this.parser.push(this.decoder.decode(bytes, { stream: true }))) this.acc.onEvent(e);
      return;
    }
    if (this.overflow) return;
    this.size += bytes.byteLength;
    if (this.size > MAX_JSON_BYTES) {
      this.overflow = true;
      this.chunks = [];
      return;
    }
    this.chunks.push(bytes.slice());
  }

  finish(): Extracted | null {
    if (this.sse) {
      for (const e of this.parser.push(this.decoder.decode())) this.acc.onEvent(e);
      for (const e of this.parser.end()) this.acc.onEvent(e);
      return this.acc.result();
    }
    if (this.overflow || this.size === 0) return null;
    const all = new Uint8Array(this.size);
    let off = 0;
    for (const c of this.chunks) {
      all.set(c, off);
      off += c.byteLength;
    }
    this.chunks = [];
    try {
      return extractJson(this.kind, JSON.parse(new TextDecoder().decode(all)));
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// request side

export interface PreparedRequest {
  /** Body to forward (original bytes unless rewritten). */
  body: Uint8Array<ArrayBuffer>;
  model?: string;
  stream: boolean;
  /** True when stream_options.include_usage was added to the forwarded body. */
  usageInjected: boolean;
}

/**
 * Reads model/stream from a metered JSON request and, for streamed Chat Completions
 * without `stream_options.include_usage`, injects it so the final chunk carries usage.
 */
export function prepareRequestBody(kind: EndpointKind, raw: Uint8Array<ArrayBuffer>): PreparedRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { body: raw, stream: false, usageInjected: false };
  }
  const b = obj(parsed);
  if (!b) return { body: raw, stream: false, usageInjected: false };
  const stream = b.stream === true;
  const model = str(b.model);
  if (kind === "openai.chat" && stream) {
    const opts = obj(b.stream_options);
    if (opts?.include_usage !== true) {
      b.stream_options = { ...opts, include_usage: true };
      return { body: new TextEncoder().encode(JSON.stringify(b)), model, stream, usageInjected: true };
    }
  }
  return { body: raw, model, stream, usageInjected: false };
}
