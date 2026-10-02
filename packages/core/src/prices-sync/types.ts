import type { Provider } from "../events.ts";

/** One price row as a source reports it, normalized to USD per million tokens. */
export interface NormalizedRow {
  provider: Provider;
  model: string;
  inputPerMTok: number;
  outputPerMTok: number;
  /** null = the source does not state a rate (not the same as 0). */
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
}

export const RATE_FIELDS = ["inputPerMTok", "outputPerMTok", "cacheReadPerMTok", "cacheWritePerMTok"] as const;
export type RateField = (typeof RATE_FIELDS)[number];

export interface SourceInfo {
  /** Short id used in provenance (`sources: ["litellm", ...]`). */
  name: string;
  /** Human-readable data location. */
  url: string;
  /** SPDX id of the license covering the data file. */
  license: string;
  copyright: string;
}

/** What an adapter returns after parsing one source. */
export interface SourceRows {
  rows: NormalizedRow[];
  /**
   * Optional fuzzy lookup for models this source does not list under the exact id
   * (e.g. genai-prices match rules covering dated snapshots). Used only to add a
   * cross-check observation to rows other sources produced; never creates rows.
   */
  resolve?: (provider: Provider, model: string) => NormalizedRow | undefined;
}

export interface SourceAdapter extends SourceInfo {
  /** Downloads the raw data. Must honour `signal` (timeouts). */
  fetch(signal: AbortSignal): Promise<unknown>;
  /** Pure: raw data -> normalized rows. `now` selects date-dependent prices. */
  parse(raw: unknown, now: Date): SourceRows;
}

export interface FieldConflict {
  field: RateField;
  /** Value per source that stated one. */
  values: Record<string, number>;
  chosen: number;
  chosenFrom: string;
}

export interface MergedRow extends NormalizedRow {
  /** Sources that listed this model (in precedence order). */
  sources: string[];
  conflicts?: FieldConflict[];
}

export interface SnapshotSource extends SourceInfo {
  fetchedAt: string;
  rows: number;
}

export interface Snapshot {
  schemaVersion: 2;
  syncedAt: string;
  notices: string;
  precedence: string[];
  tolerance: { relative: number; absolute: number };
  sources: SnapshotSource[];
  prices: MergedRow[];
}
