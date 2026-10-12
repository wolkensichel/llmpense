/**
 * ECB euro foreign exchange reference rates.
 *
 * The ECB publishes them every TARGET working day at around 16:00 CET. Reuse is free provided
 * the ECB is cited as the source and modifications (here: USD cross rates calculated via EUR)
 * are stated; see THIRD_PARTY_NOTICES.md.
 */
import { ECB_CURRENCIES, type EurRate } from "./fx.ts";

export const ECB_SOURCE = "ecb";

export const ECB_FEEDS = {
  /** Latest working day. */
  daily: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
  /** Last 90 days. */
  "90d": "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml",
  /** Since 1999 (several MB). */
  history: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml",
} as const;
export type EcbFeed = keyof typeof ECB_FEEDS;

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`).exec(tag)?.[1];

/**
 * Parses an ECB eurofxref XML document (daily, 90-day or full history) into rates per EUR.
 * Only the currencies in `currencies` are kept. Throws on anything that is not such a document.
 */
export function parseEcbXml(xml: string, currencies: readonly string[] = ECB_CURRENCIES): EurRate[] {
  if (!/eurofxref/i.test(xml) || !/<(?:\w+:)?Envelope\b/.test(xml)) {
    throw new Error("Not an ECB reference rate document (no eurofxref envelope)");
  }
  const keep = new Set(currencies);
  const out: EurRate[] = [];
  let date: string | null = null;
  let days = 0;
  for (const m of xml.matchAll(/<Cube\b[^>]*>/g)) {
    const tag = m[0];
    const time = attr(tag, "time");
    if (time !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(time)) throw new Error(`Unexpected date in ECB feed: ${time}`);
      date = time;
      days++;
      continue;
    }
    const currency = attr(tag, "currency");
    const rate = attr(tag, "rate");
    if (currency === undefined || rate === undefined) continue;
    if (!date) throw new Error("ECB feed has a rate outside a dated block");
    if (!keep.has(currency)) continue;
    const ratePerEur = Number(rate);
    if (!Number.isFinite(ratePerEur) || ratePerEur <= 0) throw new Error(`Invalid ECB rate for ${currency} on ${date}: ${rate}`);
    out.push({ date, currency, ratePerEur, source: ECB_SOURCE });
  }
  if (days === 0) throw new Error("ECB feed contains no dated rates");
  return out;
}

/**
 * Downloads and parses one ECB feed. Fails with a readable message on timeouts, HTTP errors and
 * malformed documents.
 */
export async function fetchEcbRates(
  feed: EcbFeed = "90d",
  opts: { timeoutMs?: number; fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<EurRate[]> {
  const url = ECB_FEEDS[feed];
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const signals = [AbortSignal.timeout(timeoutMs), ...(opts.signal ? [opts.signal] : [])];
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, { signal: AbortSignal.any(signals), headers: { accept: "application/xml, text/xml" } });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError") throw new Error(`ECB feed timed out after ${timeoutMs} ms (${url})`);
    throw new Error(`Could not reach the ECB feed (${url}): ${err.message}`);
  }
  if (!res.ok) throw new Error(`ECB feed returned HTTP ${res.status} (${url})`);
  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    throw new Error(`ECB feed download failed (${url}): ${(e as Error).message}`);
  }
  return parseEcbXml(body);
}
