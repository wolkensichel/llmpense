/**
 * Fetches the ECB euro foreign exchange reference rates and upserts them into `fx_rates`.
 * Idempotent: re-running only refreshes rows that already exist.
 *
 *   pnpm fx:sync                      last 90 days (default)
 *   pnpm fx:sync --feed=daily         latest working day only
 *   pnpm fx:sync --feed=history       everything since 1999 (several MB), to backfill old months
 *   options: --timeout-ms=N (default 30000)
 *
 * Source: European Central Bank, https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/
 */
import { ECB_FEEDS, type EcbFeed } from "@llmpense/core";
import { createDb } from "./client.ts";
import { syncEcbRates } from "./fx.ts";

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const feed = (opt("feed") ?? "90d") as EcbFeed;
if (!(feed in ECB_FEEDS)) {
  console.error(`Unknown --feed=${feed}. Use one of: ${Object.keys(ECB_FEEDS).join(", ")}.`);
  process.exit(2);
}
const timeoutMs = Number(opt("timeout-ms") ?? 30_000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("--timeout-ms must be a positive number.");
  process.exit(2);
}

let db: ReturnType<typeof createDb>;
try {
  db = createDb();
} catch (e) {
  console.error(`fx:sync: ${(e as Error).message}`);
  process.exit(2);
}

try {
  const r = await syncEcbRates(db, { feed, timeoutMs });
  console.log(`fx:sync: ${r.received} rates from the ECB ${feed} feed (${ECB_FEEDS[feed]}), ${r.written} written, latest ${r.latestDate}`);
  console.log("Source: European Central Bank, euro foreign exchange reference rates.");
} catch (e) {
  console.error(`fx:sync failed: ${(e as Error).message}`);
  console.error("Stored rates are unchanged. Manual rates can be set under Settings > Exchange rates.");
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
