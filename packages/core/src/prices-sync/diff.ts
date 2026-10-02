import type { FieldConflict, MergedRow, NormalizedRow, RateField } from "./types.ts";
import { RATE_FIELDS } from "./types.ts";

/** Rows of the previous snapshot; older files have no provenance fields. */
export type PreviousRow = NormalizedRow & Partial<Pick<MergedRow, "sources" | "conflicts">>;

export interface RowChange {
  provider: string;
  model: string;
  fields: { field: RateField; from: number | null; to: number | null }[];
}

export interface PriceDiff {
  added: MergedRow[];
  removed: PreviousRow[];
  changed: RowChange[];
  conflicts: MergedRow[];
}

const key = (r: { provider: string; model: string }) => `${r.provider}/${r.model}`;

export function diffSnapshots(previous: PreviousRow[], next: MergedRow[]): PriceDiff {
  const prev = new Map<string, PreviousRow>();
  // First row wins, like findPrice does for duplicate keys in older snapshots.
  for (const r of previous) if (!prev.has(key(r))) prev.set(key(r), r);
  const nextKeys = new Set(next.map(key));
  const added: MergedRow[] = [];
  const changed: RowChange[] = [];
  for (const r of next) {
    const old = prev.get(key(r));
    if (!old) {
      added.push(r);
      continue;
    }
    const fields = RATE_FIELDS.filter((f) => (old[f] ?? null) !== r[f]).map((f) => ({ field: f, from: old[f] ?? null, to: r[f] }));
    if (fields.length) changed.push({ provider: r.provider, model: r.model, fields });
  }
  const removed = previous.filter((r) => !nextKeys.has(key(r)));
  return { added, removed, changed, conflicts: next.filter((r) => r.conflicts?.length) };
}

export function isEmptyDiff(d: PriceDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0;
}

const SHORT: Record<RateField, string> = {
  inputPerMTok: "in",
  outputPerMTok: "out",
  cacheReadPerMTok: "cacheRead",
  cacheWritePerMTok: "cacheWrite",
};
const fmt = (v: number | null) => (v === null ? "-" : String(v));
const rates = (r: NormalizedRow) => RATE_FIELDS.map((f) => fmt(r[f])).join(" / ");

function conflictLine(c: FieldConflict): string {
  const vals = Object.entries(c.values)
    .map(([s, v]) => `${s}=${v}`)
    .join(", ");
  return `${SHORT[c.field]}: ${vals} -> ${c.chosen} (${c.chosenFrom})`;
}

export interface RenderContext {
  syncedAt: string;
  sources: { name: string; rows: number }[];
  failed: { name: string; error: string }[];
  totalRows: number;
}

/** Markdown review of a sync. Rates are USD per million tokens: in / out / cacheRead / cacheWrite. */
export function renderDiff(d: PriceDiff, ctx: RenderContext): string {
  const out: string[] = [];
  out.push(`# Price sync review (${ctx.syncedAt})`, "");
  out.push(`Rows: ${ctx.totalRows}. Sources: ${ctx.sources.map((s) => `${s.name} (${s.rows})`).join(", ")}.`);
  if (ctx.failed.length) out.push(`FAILED sources: ${ctx.failed.map((f) => `${f.name}: ${f.error}`).join("; ")}.`);
  out.push(`Added ${d.added.length}, removed ${d.removed.length}, changed ${d.changed.length}, rows with conflicts ${d.conflicts.length}.`, "");
  out.push("Rates: USD per million tokens, in / out / cacheRead / cacheWrite (- = not stated).", "");
  if (d.changed.length) {
    out.push("## Changed", "");
    for (const c of d.changed)
      out.push(`- ${c.provider}/${c.model}: ${c.fields.map((f) => `${SHORT[f.field]} ${fmt(f.from)} -> ${fmt(f.to)}`).join(", ")}`);
    out.push("");
  }
  if (d.added.length) {
    out.push("## Added", "");
    for (const r of d.added) out.push(`- ${r.provider}/${r.model}: ${rates(r)} [${r.sources.join(", ")}]`);
    out.push("");
  }
  if (d.removed.length) {
    out.push("## Removed", "");
    for (const r of d.removed) out.push(`- ${r.provider}/${r.model}: was ${rates(r)}`);
    out.push("");
  }
  if (d.conflicts.length) {
    out.push("## Conflicts (sources disagree; value chosen by majority, then precedence)", "");
    for (const r of d.conflicts) out.push(`- ${r.provider}/${r.model}: ${r.conflicts!.map(conflictLine).join("; ")}`);
    out.push("");
  }
  if (isEmptyDiff(d) && !d.conflicts.length) out.push("No changes.", "");
  return out.join("\n");
}
