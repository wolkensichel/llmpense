import "server-only";
import { fxResolver, latestEcbRateDate, syncEcbRates, utcDay, type FxResolver } from "@llmpense/db";
import { getDb } from "./db.ts";
import type { UsdPerUnit } from "./margin.ts";
import type { Currency } from "@llmpense/core";

/** How long a page waits for the ECB before it renders with the rates already stored. */
const WAIT_MS = 1_500;
/** The download itself keeps running in the background up to this limit. */
const FETCH_TIMEOUT_MS = 10_000;

const g = globalThis as unknown as { __llmpenseFx?: { attemptedDay?: string; inflight?: Promise<void> } };

/** Set FX_AUTO_FETCH=0 to never contact the ECB from the web app (offline installs). */
export function autoFetchEnabled() {
  return !/^(0|false|no|off)$/i.test(process.env.FX_AUTO_FETCH ?? "");
}

/**
 * Fetches the ECB reference rates at most once a day per server process, when the newest stored
 * ECB rate is older than today. Waits at most `waitMs`; on timeouts and errors the stored rates
 * (or manual rates) are used and the next attempt is the next day.
 */
export async function ensureFreshRates(now = new Date(), waitMs = WAIT_MS): Promise<void> {
  if (!autoFetchEnabled()) return;
  const state = (g.__llmpenseFx ??= {});
  const today = utcDay(now);
  if (state.attemptedDay !== today) {
    let latest: string | null;
    try {
      latest = await latestEcbRateDate(getDb());
    } catch {
      return;
    }
    if (latest !== null && latest >= today) return;
    if (state.attemptedDay === today) return;
    state.attemptedDay = today;
    state.inflight = syncEcbRates(getDb(), { feed: "90d", timeoutMs: FETCH_TIMEOUT_MS })
      .then((r) => console.info(`ECB exchange rates updated: ${r.received} rates, latest ${r.latestDate}`))
      .catch((e: Error) => console.warn(`ECB exchange rates not updated, using stored rates: ${e.message}`))
      .finally(() => {
        state.inflight = undefined;
      });
  }
  if (state.inflight) await Promise.race([state.inflight, new Promise((r) => setTimeout(r, waitMs))]);
}

/** Rates for `periods` from stored data, after a bounded attempt to refresh them. */
export async function getFx(orgId: string, periods: readonly string[], now = new Date()): Promise<FxResolver> {
  await ensureFreshRates(now);
  return fxResolver(getDb(), orgId, periods, now);
}

/** USD per unit of `currency` by month, for converting fixed fees in margins. */
export function usdPerUnit(fx: FxResolver, currency: Currency): UsdPerUnit {
  if (currency === "USD") return () => 1;
  return (period) => {
    const r = fx(currency, period);
    return r ? 1 / r.perUsd : null;
  };
}
