import { formatMoney, type Currency } from "@llmpense/core";

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd4 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });
const int = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Dollars with cents; signed values keep a true minus sign. */
export function usd(n: number): string {
  return usd2.format(n).replace("-", "−");
}

export function usdWhole(n: number): string {
  return usd0.format(n).replace("-", "−");
}

/** An amount in a billing currency, e.g. "€1,234.50" or "¥1,235". */
export function money(n: number, currency: Currency): string {
  return formatMoney(n, currency);
}

/** Per-event amounts are often fractions of a cent. */
export function usdFine(n: number): string {
  return Math.abs(n) >= 1 ? usd(n) : usd4.format(n);
}

const usd3 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });
const usdSig = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumSignificantDigits: 2, maximumSignificantDigits: 3 });

/** Unit costs such as cost per success: "$1.80", "$0.213", "$0.20", "$0.0042". */
export function usdPer(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1 ? usd2.format(n) : a >= 0.1 || a === 0 ? usd3.format(n) : usdSig.format(n);
  return s.replace("-", "−");
}

export function count(n: number): string {
  return int.format(n);
}

export function compactNum(n: number): string {
  return compact.format(n);
}

/** 0.214 -> "21.4%"; null -> "–". */
export function pct(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "–";
  return `${(ratio * 100).toFixed(digits).replace("-", "−")}%`;
}

/** Relative change; null when the base is zero. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

export function shortDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(`${d}T00:00:00Z`) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function dateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

/** "2026-09" -> "September 2026" */
export function monthLabel(period: string): string {
  return new Date(`${period}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const BILLING_LABELS = {
  markup: "Markup",
  passthrough: "Pass-through",
  fixed: "Fixed fee",
  absorbed: "Absorbed",
} as const;
