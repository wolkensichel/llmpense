/**
 * Refreshes data/prices.json from several MIT-licensed price databases, merges them
 * with conflict detection, and prints a review
 * diff against the current file (also written to data/prices.diff.md).
 *
 *   pnpm prices:sync                      fetch, merge, write prices.json + diff
 *   pnpm prices:sync --check              no write; exit 1 if stale, a source failed
 *                                         or conflicts exceed --max-conflicts
 *   options: --max-conflicts=N (default 40)  --timeout-ms=N (default 30000)
 *            --force (write even if the row count drops by more than 20%)
 *
 * Only first-party OpenAI, Anthropic and Gemini chat/text models are kept.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { diffSnapshots, isEmptyDiff, renderDiff, type PreviousRow } from "./prices-sync/diff.ts";
import { buildSnapshot, degradedReasons, fetchAll } from "./prices-sync/sync.ts";
import { SOURCES } from "./prices-sync/sources/index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: number) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  const n = a ? Number(a.split("=")[1]) : def;
  return Number.isFinite(n) ? n : def;
};
const check = flag("check");
const maxConflicts = opt("max-conflicts", 40);
const timeoutMs = opt("timeout-ms", 30_000);

const pricesPath = fileURLToPath(new URL("../data/prices.json", import.meta.url));
const diffPath = fileURLToPath(new URL("../data/prices.diff.md", import.meta.url));

const previous: PreviousRow[] = existsSync(pricesPath) ? (JSON.parse(readFileSync(pricesPath, "utf8")).prices ?? []) : [];

const now = new Date();
const fetched = await fetchAll(SOURCES, now, timeoutMs);
for (const f of fetched.failed) console.warn(`! source ${f.name} failed: ${f.error} (continuing with the others)`);
if (fetched.ok.length === 0) {
  console.error("All sources failed; nothing written.");
  process.exit(2);
}

const snapshot = buildSnapshot(fetched, now);
const diff = diffSnapshots(previous, snapshot.prices);
const report = renderDiff(diff, {
  syncedAt: snapshot.syncedAt,
  sources: snapshot.sources,
  failed: fetched.failed,
  totalRows: snapshot.prices.length,
});
console.log(report);

const problems = degradedReasons(previous.length, snapshot.prices);

if (check) {
  const failures: string[] = [...problems];
  if (!isEmptyDiff(diff)) failures.push(`snapshot is stale (${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed)`);
  if (diff.conflicts.length > maxConflicts) failures.push(`${diff.conflicts.length} rows with conflicts > --max-conflicts=${maxConflicts}`);
  if (fetched.failed.length) failures.push(`${fetched.failed.length} source(s) failed`);
  if (failures.length) {
    console.error(`check failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("check ok: snapshot is current");
  process.exit(0);
}

if (problems.length && !flag("force")) {
  console.error(`Refusing to write a degraded snapshot:\n  ${problems.join("\n  ")}\nRe-run with --force to override.`);
  process.exit(1);
}

writeFileSync(pricesPath, JSON.stringify(snapshot, null, 1) + "\n");
writeFileSync(diffPath, report);
console.log(`wrote ${snapshot.prices.length} prices to ${pricesPath}\nreview: ${diffPath}`);
