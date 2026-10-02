import type { FieldConflict, MergedRow, NormalizedRow, RateField, SourceRows } from "./types.ts";
import { RATE_FIELDS } from "./types.ts";

export interface Tolerance {
  /** Relative difference treated as equal (0.005 = 0.5%). */
  relative: number;
  /** Absolute difference in USD/MTok treated as equal. */
  absolute: number;
}

export const DEFAULT_TOLERANCE: Tolerance = { relative: 0.005, absolute: 1e-6 };

export interface NamedSourceRows extends SourceRows {
  name: string;
}

export function agree(a: number, b: number, tol: Tolerance = DEFAULT_TOLERANCE): boolean {
  return Math.abs(a - b) <= Math.max(tol.absolute, tol.relative * Math.max(Math.abs(a), Math.abs(b)));
}

const key = (r: Pick<NormalizedRow, "provider" | "model">) => `${r.provider}/${r.model}`;

/**
 * Picks one value per field from the sources' observations.
 * Rule: values that agree within tolerance form a group; the largest group wins
 * (majority), ties go to the group holding the highest-precedence source, and the
 * chosen value is that source's. Any disagreement is reported as a conflict.
 * Null means "not stated" and never conflicts with a number.
 */
function pickField(
  field: RateField,
  obs: { source: string; row: NormalizedRow }[],
  tol: Tolerance,
): { value: number | null; conflict?: FieldConflict } {
  const groups: { source: string; value: number }[][] = [];
  for (const { source, row } of obs) {
    const value = row[field];
    if (value === null) continue;
    const g = groups.find((grp) => agree(grp[0]!.value, value, tol));
    if (g) g.push({ source, value });
    else groups.push([{ source, value }]);
  }
  if (groups.length === 0) return { value: null };
  // Groups are created in precedence order, so the first max-size group wins ties.
  let best = groups[0]!;
  for (const g of groups) if (g.length > best.length) best = g;
  const chosen = best[0]!;
  if (groups.length === 1) return { value: chosen.value };
  const values: Record<string, number> = {};
  for (const g of groups) for (const o of g) values[o.source] = o.value;
  return { value: chosen.value, conflict: { field, values, chosen: chosen.value, chosenFrom: chosen.source } };
}

/**
 * Merges per-source rows. `sources` must be in precedence order (highest first).
 * Every (provider, model) any source lists exactly becomes one row; a source's
 * `resolve` hook may add a cross-check observation for ids it lists under another name.
 */
export function mergeSources(sources: NamedSourceRows[], tol: Tolerance = DEFAULT_TOLERANCE): MergedRow[] {
  const exact = sources.map((s) => new Map(s.rows.map((r) => [key(r), r] as const)));
  const keys = new Map<string, NormalizedRow>();
  for (const s of sources) for (const r of s.rows) if (!keys.has(key(r))) keys.set(key(r), r);

  const merged: MergedRow[] = [];
  for (const [k, first] of keys) {
    const obs: { source: string; row: NormalizedRow }[] = [];
    sources.forEach((s, i) => {
      const row = exact[i]!.get(k) ?? s.resolve?.(first.provider, first.model);
      if (row) obs.push({ source: s.name, row });
    });
    const conflicts: FieldConflict[] = [];
    const rates = {} as Record<RateField, number | null>;
    for (const field of RATE_FIELDS) {
      const { value, conflict } = pickField(field, obs, tol);
      rates[field] = value;
      if (conflict) conflicts.push(conflict);
    }
    merged.push({
      provider: first.provider,
      model: first.model,
      inputPerMTok: rates.inputPerMTok!,
      outputPerMTok: rates.outputPerMTok!,
      cacheReadPerMTok: rates.cacheReadPerMTok,
      cacheWritePerMTok: rates.cacheWritePerMTok,
      sources: obs.map((o) => o.source),
      ...(conflicts.length ? { conflicts } : {}),
    });
  }
  return merged.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
}
