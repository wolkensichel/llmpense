/**
 * Billing currencies and exchange rates.
 *
 * USD is the accounting currency: provider costs, per-event billed amounts and margins are in
 * USD. A client can be billed in another currency; its statement converts the USD amounts with
 * one rate per month. Rates come from the ECB euro reference rates (quoted per 1 EUR), so a USD
 * rate is a cross rate via EUR. Manual rates per org (quoted per 1 USD) take precedence.
 */
export const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BASE_CURRENCY: Currency = "USD";

/** Currencies the ECB quotes against the euro that LLMpense stores. */
export const ECB_CURRENCIES = ["USD", "GBP", "JPY", "CNY", "CHF"] as const;

export const CURRENCY_NAMES: Record<Currency, string> = {
  USD: "US dollar",
  EUR: "Euro",
  GBP: "Pound sterling",
  JPY: "Japanese yen",
  CNY: "Chinese yuan renminbi",
  CHF: "Swiss franc",
};

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
}

/** Decimal places of the currency's minor unit (ISO 4217): JPY has none. */
export function minorUnits(c: Currency): number {
  return c === "JPY" ? 0 : 2;
}

/** Rounds to the currency's minor unit, half away from zero. */
export function roundMinor(n: number, c: Currency): number {
  const f = 10 ** minorUnits(c);
  const r = Math.round((Math.abs(n) + Number.EPSILON) * f) / f;
  return n < 0 && r !== 0 ? -r : r;
}

// ---------------------------------------------------------------- rates

/** Where a rate came from. `seed` rows are demo data inserted by the seed script. */
export type FxSource = "identity" | "ecb" | "manual" | "seed";

/** A stored reference rate: units of `currency` per 1 EUR on `date` (YYYY-MM-DD). */
export interface EurRate {
  date: string;
  currency: string;
  ratePerEur: number;
  /** Free text from the source column, e.g. `ecb` or `seed (demo data, not ECB)`. */
  source: string;
}

/** A manual rate for one org: units of `currency` per 1 USD, valid from `effectiveFrom`. */
export interface RateOverride {
  currency: Currency;
  perUsd: number;
  /** YYYY-MM-DD */
  effectiveFrom: string;
}

/** The rate a statement uses: 1 USD = `perUsd` units of `currency`. */
export interface FxRate {
  currency: Currency;
  perUsd: number;
  /** Date of the rate (YYYY-MM-DD); null for USD. */
  date: string | null;
  source: FxSource;
}

/** Source column of the demo exchange rates the seed inserts. */
export const SEED_RATE_SOURCE = "seed (demo data, not ECB)";

export const USD_RATE: FxRate = { currency: "USD", perUsd: 1, date: null, source: "identity" };

/** Maps a stored source column to its kind. */
export function sourceKind(source: string): FxSource {
  if (source === "manual") return "manual";
  if (source.startsWith("seed")) return "seed";
  if (source === "identity") return "identity";
  return "ecb";
}

/**
 * Cross rate via EUR: with `usdPerEur` USD and `targetPerEur` units of the target per 1 EUR,
 * 1 USD buys `targetPerEur / usdPerEur` units of the target. For EUR itself it is 1 / usdPerEur.
 */
export function crossRate(usdPerEur: number, targetPerEur: number): number {
  if (!(usdPerEur > 0) || !(targetPerEur > 0)) throw new Error("Exchange rates must be positive");
  return targetPerEur / usdPerEur;
}

/** USD to the rate's currency, rounded to the currency's minor unit. */
export function fromUsd(amountUsd: number, rate: FxRate): number {
  return roundMinor(amountUsd * rate.perUsd, rate.currency);
}

/** An amount in the rate's currency back to USD, full precision (8 decimals). */
export function toUsd(amount: number, rate: FxRate): number {
  return Math.round((amount / rate.perUsd) * 1e8) / 1e8;
}

/** The last calendar day of a `YYYY-MM` period, as YYYY-MM-DD. */
export function periodLastDay(period: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new Error(`Invalid period: ${period}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
}

/**
 * The latest rate date a statement for `period` may use: the month's last day, or `today` while
 * the month is still running. The rate applied is the latest available on or before it, so a
 * month ending on a weekend or holiday uses its last business day.
 */
export function rateCutoff(period: string, today: string): string {
  const last = periodLastDay(period);
  return today < last ? today : last;
}

/**
 * Picks the rate for one currency and month.
 * 1. A manual rate of the org with `effectiveFrom` on or before the cutoff wins (latest first).
 * 2. Otherwise the ECB cross rate of the latest date on or before the cutoff that has both
 *    the USD and the target rate.
 * Returns null when neither exists.
 */
export function selectRate(input: {
  currency: Currency;
  period: string;
  today: string;
  rates: readonly EurRate[];
  overrides?: readonly RateOverride[];
}): FxRate | null {
  const { currency } = input;
  if (currency === "USD") return USD_RATE;
  const cutoff = rateCutoff(input.period, input.today);

  let manual: RateOverride | undefined;
  for (const o of input.overrides ?? []) {
    if (o.currency !== currency || o.effectiveFrom > cutoff || !(o.perUsd > 0)) continue;
    if (!manual || o.effectiveFrom > manual.effectiveFrom) manual = o;
  }
  if (manual) return { currency, perUsd: manual.perUsd, date: manual.effectiveFrom, source: "manual" };

  const byDate = new Map<string, Map<string, EurRate>>();
  for (const r of input.rates) {
    if (r.date > cutoff || !(r.ratePerEur > 0)) continue;
    const day = byDate.get(r.date) ?? new Map<string, EurRate>();
    day.set(r.currency, r);
    byDate.set(r.date, day);
  }
  for (const date of [...byDate.keys()].sort().reverse()) {
    const day = byDate.get(date)!;
    const usd = day.get("USD");
    const target = currency === "EUR" ? null : day.get(currency);
    if (!usd || (currency !== "EUR" && !target)) continue;
    const perUsd = crossRate(usd.ratePerEur, target ? target.ratePerEur : 1);
    // A day mixing demo and ECB rows counts as demo data.
    const kinds = [usd, target].filter((r): r is EurRate => !!r).map((r) => sourceKind(r.source));
    return { currency, perUsd, date, source: kinds.includes("seed") ? "seed" : kinds.includes("manual") ? "manual" : "ecb" };
  }
  return null;
}

// ---------------------------------------------------------------- display

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "0.9213" for rates below 10, "158.26" above. */
export function formatRate(perUsd: number): string {
  return perUsd >= 10 ? perUsd.toFixed(2) : perUsd.toFixed(4);
}

/** "30 Sep 2026" */
export function formatRateDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}

/**
 * The note printed on statements in a currency other than USD, e.g.
 * "1 USD = 0.9213 EUR, ECB reference rate of 30 Sep 2026". Null for USD.
 */
export function rateNote(rate: FxRate | null): string | null {
  if (!rate || rate.currency === "USD" || !rate.date) return null;
  const what = rate.source === "manual" ? "manual rate" : rate.source === "seed" ? "demo rate (seed data)" : "ECB reference rate";
  return `1 USD = ${formatRate(rate.perUsd)} ${rate.currency}, ${what} of ${formatRateDate(rate.date)}`;
}

/** Source acknowledgement for statements that use an ECB rate, as the ECB reuse terms ask. */
export const ECB_ACKNOWLEDGEMENT =
  "Source: European Central Bank, euro foreign exchange reference rates. The USD rate is a cross rate calculated via EUR by LLMpense.";

const formatters = new Map<string, Intl.NumberFormat>();

/** Money in a currency, e.g. "€1,234.50", "¥1,235", "CHF 12.00"; a true minus sign for negatives. */
export function formatMoney(n: number, c: Currency): string {
  const key = c;
  let f = formatters.get(key);
  if (!f) {
    const d = minorUnits(c);
    f = new Intl.NumberFormat("en-US", { style: "currency", currency: c, minimumFractionDigits: d, maximumFractionDigits: d });
    formatters.set(key, f);
  }
  return f.format(n).replace("-", "−");
}
