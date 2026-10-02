import { describe, expect, it } from "vitest";
import {
  classifyEndpoint,
  extractJson,
  extractSse,
  MAX_JSON_BYTES,
  prepareRequestBody,
  SseParser,
  UsageCollector,
  type EndpointKind,
} from "../src/usage.ts";

const enc = new TextEncoder();
const sse = (events: { event?: string; data: unknown }[], eol = "\n") =>
  events
    .map((e) => (e.event ? `event: ${e.event}${eol}` : "") + `data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}${eol}${eol}`)
    .join("");

/** Splits a string at every possible position pair and checks the result is stable. */
function everySplit(kind: EndpointKind, body: string) {
  const whole = extractSse(kind, body);
  for (let i = 1; i < body.length; i += 7) {
    expect(extractSse(kind, [body.slice(0, i), body.slice(i)])).toEqual(whole);
  }
  // One character per chunk.
  expect(extractSse(kind, [...body])).toEqual(whole);
  return whole;
}

describe("classifyEndpoint", () => {
  it.each([
    ["openai", "POST", "/v1/chat/completions", "openai.chat"],
    ["openai", "POST", "/v1/responses", "openai.responses"],
    ["openai", "POST", "/v1/embeddings", "openai.embeddings"],
    ["openai", "GET", "/v1/models", null],
    ["openai", "GET", "/v1/responses/resp_1", null],
    ["openai", "POST", "/v1/audio/speech", null],
    ["gemini", "POST", "/v1beta/openai/chat/completions", "openai.chat"],
    ["gemini", "POST", "/v1beta/openai/embeddings", "openai.embeddings"],
    ["gemini", "POST", "/v1beta/models/gemini-2.5-flash:generateContent", null],
    ["anthropic", "POST", "/v1/messages", "anthropic.messages"],
    ["anthropic", "POST", "/v1/messages/count_tokens", null],
    ["anthropic", "POST", "/v1/messages/batches", null],
  ] as const)("%s %s %s -> %s", (up, method, path, kind) => {
    expect(classifyEndpoint(up, method, path)).toBe(kind);
  });
});

describe("OpenAI chat completions", () => {
  it("non-stream: input excludes cached tokens", () => {
    const r = extractJson("openai.chat", {
      id: "chatcmpl-123",
      model: "gpt-5-mini-2025-08-07",
      choices: [],
      usage: { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500, prompt_tokens_details: { cached_tokens: 1000 } },
    });
    expect(r).toEqual({
      usage: { inputTokens: 200, outputTokens: 300, cacheReadTokens: 1000, cacheWriteTokens: 0 },
      model: "gpt-5-mini-2025-08-07",
      requestId: "chatcmpl-123",
    });
  });

  it("non-stream: no usage -> null; missing details -> zero cache", () => {
    expect(extractJson("openai.chat", { error: { message: "bad" } })).toBeNull();
    expect(extractJson("openai.chat", "nope")).toBeNull();
    expect(extractJson("openai.chat", { usage: { prompt_tokens: 5, completion_tokens: 1 } })?.usage).toEqual({
      inputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  const chatStream = sse([
    { data: { id: "chatcmpl-9", model: "gpt-5", choices: [{ delta: { role: "assistant", content: "" } }], usage: null } },
    { data: { id: "chatcmpl-9", model: "gpt-5", choices: [{ delta: { content: "Hel" } }], usage: null } },
    { data: { id: "chatcmpl-9", model: "gpt-5", choices: [{ delta: { content: "lo" }, finish_reason: "stop" }], usage: null } },
    {
      data: {
        id: "chatcmpl-9",
        model: "gpt-5",
        choices: [],
        usage: { prompt_tokens: 50, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 10 } },
      },
    },
    { data: "[DONE]" },
  ]);

  it("stream: usage from the final chunk", () => {
    expect(extractSse("openai.chat", chatStream)).toEqual({
      usage: { inputTokens: 40, outputTokens: 7, cacheReadTokens: 10, cacheWriteTokens: 0 },
      model: "gpt-5",
      requestId: "chatcmpl-9",
    });
  });

  it("stream: robust to chunk boundaries and CRLF", () => {
    expect(everySplit("openai.chat", chatStream)?.usage.outputTokens).toBe(7);
    const crlf = chatStream.replace(/\n/g, "\r\n");
    expect(everySplit("openai.chat", crlf)).toEqual(extractSse("openai.chat", chatStream));
  });

  it("stream without include_usage yields nothing", () => {
    expect(extractSse("openai.chat", sse([{ data: { id: "x", choices: [] } }, { data: "[DONE]" }]))).toBeNull();
  });

  it("Gemini OpenAI-compat chunks parse the same way", () => {
    const body = sse([
      { data: { id: "abc", model: "gemini-2.5-flash", choices: [{ delta: { content: "hi" } }] } },
      { data: { id: "abc", model: "gemini-2.5-flash", choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } } },
      { data: "[DONE]" },
    ]);
    expect(extractSse("openai.chat", body)?.usage).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});

describe("OpenAI Responses API", () => {
  it("non-stream", () => {
    const r = extractJson("openai.responses", {
      id: "resp_abc",
      object: "response",
      model: "gpt-5",
      usage: { input_tokens: 900, input_tokens_details: { cached_tokens: 100 }, output_tokens: 250, output_tokens_details: { reasoning_tokens: 200 } },
    });
    expect(r).toEqual({
      usage: { inputTokens: 800, outputTokens: 250, cacheReadTokens: 100, cacheWriteTokens: 0 },
      model: "gpt-5",
      requestId: "resp_abc",
    });
  });

  const body = sse([
    { event: "response.created", data: { type: "response.created", response: { id: "resp_1", model: "gpt-5", usage: null } } },
    { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Hi" } },
    {
      event: "response.completed",
      data: {
        type: "response.completed",
        response: { id: "resp_1", model: "gpt-5", usage: { input_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5 } },
      },
    },
  ]);

  it("stream: usage from response.completed", () => {
    expect(extractSse("openai.responses", body)).toEqual({
      usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: "gpt-5",
      requestId: "resp_1",
    });
  });

  it("stream: chunk boundaries", () => {
    expect(everySplit("openai.responses", body)?.requestId).toBe("resp_1");
  });

  it("stream without a terminal event yields nothing", () => {
    expect(extractSse("openai.responses", body.split("event: response.completed")[0]!)).toBeNull();
  });
});

describe("OpenAI embeddings", () => {
  it("prompt tokens, zero output", () => {
    const r = extractJson("openai.embeddings", {
      object: "list",
      data: [{ embedding: [0.1, 0.2] }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 8, total_tokens: 8 },
    });
    expect(r).toEqual({
      usage: { inputTokens: 8, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: "text-embedding-3-small",
      requestId: undefined,
    });
  });
});

describe("Anthropic messages", () => {
  it("non-stream: input already excludes cache", () => {
    const r = extractJson("anthropic.messages", {
      id: "msg_01",
      type: "message",
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 20, output_tokens: 400, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
    });
    expect(r).toEqual({
      usage: { inputTokens: 20, outputTokens: 400, cacheReadTokens: 3000, cacheWriteTokens: 500 },
      model: "claude-sonnet-5-5",
      requestId: "msg_01",
    });
  });

  it("non-stream: null cache fields are zero", () => {
    const r = extractJson("anthropic.messages", {
      id: "msg_02",
      usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    });
    expect(r?.usage).toEqual({ inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  const body = sse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_stream",
          model: "claude-haiku-4-5",
          usage: { input_tokens: 25, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
        },
      },
    },
    { event: "ping", data: { type: "ping" } },
    { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } } },
    { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: null }, usage: { output_tokens: 10 } } },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 42, input_tokens: null, cache_creation_input_tokens: 7 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);

  it("stream: input from message_start, last cumulative output, later non-null values win", () => {
    expect(extractSse("anthropic.messages", body)).toEqual({
      usage: { inputTokens: 25, outputTokens: 42, cacheReadTokens: 100, cacheWriteTokens: 7 },
      model: "claude-haiku-4-5",
      requestId: "msg_stream",
    });
  });

  it("stream: chunk boundaries", () => {
    expect(everySplit("anthropic.messages", body)?.usage.outputTokens).toBe(42);
  });

  it("stream cut before message_delta still reports input", () => {
    const cut = body.slice(0, body.indexOf("event: message_delta"));
    expect(extractSse("anthropic.messages", cut)?.usage).toEqual({
      inputTokens: 25,
      outputTokens: 1,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    });
  });

  it("error event only -> null", () => {
    expect(
      extractSse("anthropic.messages", sse([{ event: "error", data: { type: "error", error: { type: "overloaded_error" } } }])),
    ).toBeNull();
  });
});

describe("SseParser", () => {
  it("handles several events per chunk, comments, multi-line data and a trailing event without blank line", () => {
    const p = new SseParser();
    const out = p.push(": keepalive\n\nevent: a\ndata: 1\n\ndata: x\ndata: y\n\nid: 3\ndata:no-space\n\ndata: tail");
    expect(out).toEqual([
      { event: "a", data: "1" },
      { event: undefined, data: "x\ny" },
      { event: undefined, data: "no-space" },
    ]);
    expect(p.end()).toEqual([{ event: undefined, data: "tail" }]);
  });

  it("does not split CRLF across chunks into two line ends", () => {
    const p = new SseParser();
    expect(p.push("data: 1\r")).toEqual([]);
    expect(p.push("\n\r")).toEqual([]);
    expect(p.push("\n")).toEqual([{ event: undefined, data: "1" }]);
  });
});

describe("UsageCollector (bytes)", () => {
  it("SSE with multi-byte UTF-8 split mid-character", () => {
    const text = sse([
      { data: { id: "chatcmpl-u", model: "gpt-5", choices: [{ delta: { content: "héllo ✓" } }] } },
      { data: { id: "chatcmpl-u", model: "gpt-5", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } } },
    ]);
    const bytes = enc.encode(text);
    const c = new UsageCollector("openai.chat", true);
    for (let i = 0; i < bytes.length; i += 3) c.push(bytes.slice(i, i + 3));
    expect(c.finish()?.usage.outputTokens).toBe(2);
  });

  it("JSON body across chunks", () => {
    const bytes = enc.encode(JSON.stringify({ id: "msg_x", model: "claude-x", usage: { input_tokens: 1, output_tokens: 2 } }));
    const c = new UsageCollector("anthropic.messages", false);
    c.push(bytes.slice(0, 10));
    c.push(bytes.slice(10));
    expect(c.finish()).toEqual({
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
      model: "claude-x",
      requestId: "msg_x",
    });
  });

  it("gives up on oversize or invalid JSON", () => {
    const big = new UsageCollector("openai.embeddings", false);
    big.push(new Uint8Array(MAX_JSON_BYTES + 1));
    expect(big.finish()).toBeNull();
    const bad = new UsageCollector("openai.chat", false);
    bad.push(enc.encode("<html>502</html>"));
    expect(bad.finish()).toBeNull();
  });
});

describe("prepareRequestBody", () => {
  const raw = (o: unknown) => enc.encode(JSON.stringify(o));
  const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

  it("injects include_usage for streamed chat completions", () => {
    const r = prepareRequestBody("openai.chat", raw({ model: "gpt-5", stream: true, messages: [] }));
    expect(r.usageInjected).toBe(true);
    expect(r.model).toBe("gpt-5");
    expect(dec(r.body).stream_options).toEqual({ include_usage: true });
  });

  it("keeps other stream_options and leaves bodies with include_usage untouched", () => {
    const r = prepareRequestBody("openai.chat", raw({ stream: true, stream_options: { include_obfuscation: false } }));
    expect(dec(r.body).stream_options).toEqual({ include_obfuscation: false, include_usage: true });
    const original = raw({ stream: true, stream_options: { include_usage: true } });
    const same = prepareRequestBody("openai.chat", original);
    expect(same.usageInjected).toBe(false);
    expect(same.body).toBe(original);
  });

  it("does not touch non-stream, responses, anthropic or non-JSON bodies", () => {
    for (const [kind, body] of [
      ["openai.chat", { stream: false }],
      ["openai.responses", { stream: true }],
      ["anthropic.messages", { stream: true, model: "claude-x" }],
    ] as const) {
      const original = raw(body);
      const r = prepareRequestBody(kind, original);
      expect(r.usageInjected).toBe(false);
      expect(r.body).toBe(original);
    }
    const junk = enc.encode("not json");
    expect(prepareRequestBody("openai.chat", junk)).toEqual({ body: junk, stream: false, usageInjected: false });
  });
});
