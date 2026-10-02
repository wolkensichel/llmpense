import { DEFAULT_TOLERANCE, mergeSources, type NamedSourceRows, type Tolerance } from "./merge.ts";
import type { MergedRow, Snapshot, SnapshotSource, SourceAdapter } from "./types.ts";

export interface FetchOutcome {
  ok: (NamedSourceRows & { info: SnapshotSource })[];
  failed: { name: string; error: string }[];
}

/** Fetches and parses every source independently; one failure never stops the others. */
export async function fetchAll(adapters: SourceAdapter[], now: Date, timeoutMs: number): Promise<FetchOutcome> {
  const results = await Promise.allSettled(
    adapters.map(async (a) => {
      const raw = await a.fetch(AbortSignal.timeout(timeoutMs));
      const parsed = a.parse(raw, now);
      if (parsed.rows.length === 0) throw new Error("parsed 0 rows (format change?)");
      return { a, parsed, fetchedAt: new Date().toISOString() };
    }),
  );
  const out: FetchOutcome = { ok: [], failed: [] };
  results.forEach((r, i) => {
    const a = adapters[i]!;
    if (r.status === "fulfilled") {
      const { parsed, fetchedAt } = r.value;
      out.ok.push({
        name: a.name,
        ...parsed,
        info: { name: a.name, url: a.url, license: a.license, copyright: a.copyright, fetchedAt, rows: parsed.rows.length },
      });
    } else {
      const e = r.reason as Error;
      out.failed.push({ name: a.name, error: e?.name === "TimeoutError" ? `timeout after ${timeoutMs} ms` : String(e?.message ?? e) });
    }
  });
  return out;
}

export function buildSnapshot(fetched: FetchOutcome, syncedAt: Date, tol: Tolerance = DEFAULT_TOLERANCE): Snapshot {
  return {
    schemaVersion: 2,
    syncedAt: syncedAt.toISOString(),
    notices: "THIRD_PARTY_NOTICES.md (repository root): price data from the sources below, used under the MIT License",
    precedence: fetched.ok.map((s) => s.name),
    tolerance: tol,
    sources: fetched.ok.map((s) => s.info),
    prices: mergeSources(fetched.ok, tol),
  };
}

/** Reasons not to write the new snapshot (empty or a big drop vs the current file). */
export function degradedReasons(previousRows: number, next: MergedRow[], maxDropRatio = 0.2): string[] {
  const reasons: string[] = [];
  if (next.length === 0) reasons.push("merged snapshot is empty");
  if (previousRows > 0 && next.length < previousRows * (1 - maxDropRatio))
    reasons.push(`row count dropped from ${previousRows} to ${next.length} (> ${maxDropRatio * 100}%)`);
  const bad = next.filter((r) => !(r.inputPerMTok >= 0 && r.outputPerMTok >= 0));
  if (bad.length) reasons.push(`${bad.length} rows without valid input/output rates`);
  return reasons;
}
