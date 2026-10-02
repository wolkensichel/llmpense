import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBatcher, type ProxyEvent } from "../src/batcher.ts";

const ev = (n: number): ProxyEvent => ({ provider: "openai", model: "gpt-5", inputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
const ctx = (key: string) => ({ orgId: "org", source: "proxy" as const, apiKeyId: key });

afterEach(() => vi.useRealTimers());

describe("EventBatcher", () => {
  it("flushes on the interval, grouped per key", async () => {
    vi.useFakeTimers();
    const sink = vi.fn(async () => {});
    const b = new EventBatcher(sink, { intervalMs: 1000 });
    b.add(ctx("a"), ev(1));
    b.add(ctx("b"), ev(2));
    b.add(ctx("a"), ev(3));
    expect(sink).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink).toHaveBeenCalledWith(ctx("a"), [ev(1), ev(3)]);
    expect(sink).toHaveBeenCalledWith(ctx("b"), [ev(2)]);
  });

  it("flushes immediately at maxBatch", async () => {
    const sink = vi.fn(async () => {});
    const b = new EventBatcher(sink, { intervalMs: 60_000, maxBatch: 3 });
    for (let i = 0; i < 3; i++) b.add(ctx("a"), ev(i));
    await b.flush();
    expect(sink).toHaveBeenCalledTimes(1);
    expect((sink.mock.calls[0] as unknown[])[1]).toHaveLength(3);
  });

  it("logs and survives sink failures", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const sink = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const b = new EventBatcher(sink);
    b.add(ctx("a"), ev(1));
    await b.flush();
    b.add(ctx("a"), ev(2));
    await b.flush();
    expect(sink).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("db down"));
    err.mockRestore();
  });
});
