import { describe, expect, it } from "vitest";
import { diffSnapshots, isEmptyDiff, renderDiff } from "./diff.ts";
import { agree, mergeSources, type NamedSourceRows } from "./merge.ts";
import { buildSnapshot, degradedReasons, fetchAll } from "./sync.ts";
import type { MergedRow, NormalizedRow, SourceAdapter } from "./types.ts";

const row = (model: string, input: number, output: number, read: number | null = null, write: number | null = null, provider: NormalizedRow["provider"] = "anthropic"): NormalizedRow => ({
  provider,
  model,
  inputPerMTok: input,
  outputPerMTok: output,
  cacheReadPerMTok: read,
  cacheWritePerMTok: write,
});

const src = (name: string, rows: NormalizedRow[], resolve?: NamedSourceRows["resolve"]): NamedSourceRows => ({ name, rows, resolve });

describe("agree", () => {
  it("uses relative and absolute tolerance", () => {
    expect(agree(3, 3.01)).toBe(true); // 0.33%
    expect(agree(3, 3.1)).toBe(false);
    expect(agree(0, 0.0000005)).toBe(true);
  });
});

describe("mergeSources", () => {
  it("accepts agreeing sources and records all of them", () => {
    const merged = mergeSources([src("a", [row("m", 4, 20, 0.2, 5)]), src("b", [row("m", 4, 20.000001, 0.2, null)])]);
    expect(merged).toEqual([{ ...row("m", 4, 20, 0.2, 5), sources: ["a", "b"] }]);
  });

  it("keeps single-source models with their source", () => {
    const merged = mergeSources([src("a", [row("x", 1, 2)]), src("b", [row("y", 3, 4)])]);
    expect(merged.map((r) => [r.model, r.sources])).toEqual([
      ["x", ["a"]],
      ["y", ["b"]],
    ]);
  });

  it("on disagreement prefers the majority, and records the conflict", () => {
    const merged = mergeSources([src("a", [row("m", 5, 30)]), src("b", [row("m", 4, 20)]), src("c", [row("m", 4, 20)])]);
    expect(merged[0]).toMatchObject({ inputPerMTok: 4, outputPerMTok: 20, sources: ["a", "b", "c"] });
    expect(merged[0]!.conflicts).toEqual([
      { field: "inputPerMTok", values: { a: 5, b: 4, c: 4 }, chosen: 4, chosenFrom: "b" },
      { field: "outputPerMTok", values: { a: 30, b: 20, c: 20 }, chosen: 20, chosenFrom: "b" },
    ]);
  });

  it("breaks ties by precedence (source order)", () => {
    const merged = mergeSources([src("a", [row("m", 1, 2, 0.1)]), src("b", [row("m", 1, 2, 0.5)])]);
    expect(merged[0]!.cacheReadPerMTok).toBe(0.1);
    expect(merged[0]!.conflicts).toEqual([{ field: "cacheReadPerMTok", values: { a: 0.1, b: 0.5 }, chosen: 0.1, chosenFrom: "a" }]);
  });

  it("fills a null cache rate from another source without a conflict", () => {
    const merged = mergeSources([src("a", [row("m", 1, 2, null, null)]), src("b", [row("m", 1, 2, 0.1, 1.25)])]);
    expect(merged[0]).toMatchObject({ cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 });
    expect(merged[0]!.conflicts).toBeUndefined();
  });

  it("uses resolve() only as a cross-check, never to create rows", () => {
    const resolve = (provider: NormalizedRow["provider"], model: string) => (model.startsWith("m-") ? row(model, 9, 9) : undefined);
    const merged = mergeSources([src("a", [row("m-2026", 1, 2)]), src("b", [row("other", 1, 1)], resolve)]);
    expect(merged.map((r) => r.model)).toEqual(["m-2026", "other"]);
    expect(merged[0]!.sources).toEqual(["a", "b"]);
    expect(merged[0]!.conflicts?.map((c) => c.field)).toEqual(["inputPerMTok", "outputPerMTok"]);
  });

  it("separates providers and sorts output", () => {
    const merged = mergeSources([src("a", [row("z", 1, 1, null, null, "openai"), row("z", 2, 2), row("a", 1, 1, null, null, "gemini")])]);
    expect(merged.map((r) => `${r.provider}/${r.model}`)).toEqual(["anthropic/z", "gemini/a", "openai/z"]);
  });
});

describe("diffSnapshots / renderDiff", () => {
  const merged = (r: NormalizedRow, sources = ["a"]): MergedRow => ({ ...r, sources });

  it("reports added, removed, changed and conflicts", () => {
    const prev = [row("keep", 1, 2), row("gone", 1, 1), row("chg", 3, 15, null), row("chg", 99, 99)];
    const next = [
      merged(row("keep", 1, 2)),
      merged(row("chg", 3, 15, 0.3)),
      { ...merged(row("new", 5, 25), ["a", "b"]), conflicts: [{ field: "inputPerMTok" as const, values: { a: 5, b: 6 }, chosen: 5, chosenFrom: "a" }] },
    ];
    const d = diffSnapshots(prev, next);
    expect(d.added.map((r) => r.model)).toEqual(["new"]);
    expect(d.removed.map((r) => r.model)).toEqual(["gone"]);
    expect(d.changed).toEqual([{ provider: "anthropic", model: "chg", fields: [{ field: "cacheReadPerMTok", from: null, to: 0.3 }] }]);
    expect(d.conflicts.map((r) => r.model)).toEqual(["new"]);
    expect(isEmptyDiff(d)).toBe(false);

    const md = renderDiff(d, { syncedAt: "T", sources: [{ name: "a", rows: 3 }], failed: [{ name: "b", error: "timeout" }], totalRows: 3 });
    expect(md).toContain("FAILED sources: b: timeout");
    expect(md).toContain("- anthropic/chg: cacheRead - -> 0.3");
    expect(md).toContain("- anthropic/new: 5 / 25 / - / - [a, b]");
    expect(md).toContain("- anthropic/gone: was 1 / 1 / - / -");
    expect(md).toContain("in: a=5, b=6 -> 5 (a)");
  });

  it("is empty when nothing changed", () => {
    const d = diffSnapshots([row("m", 1, 2)], [merged(row("m", 1, 2))]);
    expect(isEmptyDiff(d)).toBe(true);
    expect(renderDiff(d, { syncedAt: "T", sources: [], failed: [], totalRows: 1 })).toContain("No changes.");
  });
});

describe("sync guards", () => {
  const adapter = (name: string, fetch: SourceAdapter["fetch"], rows: NormalizedRow[] = [row("m", 1, 2)]): SourceAdapter => ({
    name,
    url: `https://example.test/${name}`,
    license: "MIT",
    copyright: "c",
    fetch,
    parse: () => ({ rows }),
  });

  it("continues when one source fails or returns nothing", async () => {
    const out = await fetchAll(
      [
        adapter("ok", async () => ({})),
        adapter("boom", async () => {
          throw new Error("HTTP 500");
        }),
        adapter("empty", async () => ({}), []),
      ],
      new Date(),
      1000,
    );
    expect(out.ok.map((s) => s.name)).toEqual(["ok"]);
    expect(out.failed).toEqual([
      { name: "boom", error: "HTTP 500" },
      { name: "empty", error: "parsed 0 rows (format change?)" },
    ]);
    const snap = buildSnapshot(out, new Date("2026-01-01T00:00:00Z"));
    expect(snap.sources.map((s) => s.name)).toEqual(["ok"]);
    expect(snap.prices).toHaveLength(1);
  });

  it("times out slow sources", async () => {
    const slow = adapter("slow", (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
    const out = await fetchAll([slow], new Date(), 20);
    expect(out.failed[0]!.error).toBe("timeout after 20 ms");
  });

  it("refuses empty snapshots and drops above 20%", () => {
    expect(degradedReasons(10, [])).toContain("merged snapshot is empty");
    const rows = Array.from({ length: 7 }, (_, i) => ({ ...row(`m${i}`, 1, 1), sources: ["a"] }));
    expect(degradedReasons(10, rows)[0]).toMatch(/dropped from 10 to 7/);
    expect(degradedReasons(8, rows)).toEqual([]);
  });
});
