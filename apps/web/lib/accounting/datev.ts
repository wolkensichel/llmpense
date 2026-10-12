import { encodeCp1252 } from "./cp1252.ts";
import { DATEV_COLUMNS } from "./datev-columns.ts";
import type { ExportInvoice } from "./common.ts";

/**
 * DATEV-Format "Buchungsstapel" (EXTF, header version 700, format category 21, format version 13).
 *
 * Line 1 is the header record, line 2 the column headings, then one posting per statement: the
 * statement total on the debtor account (debit, "S") against the revenue account, dated with the
 * issue date, the statement number in "Belegfeld 1" and the due date in "Fälligkeit".
 *
 * Technical rules from the format description: semicolon separated, CR/LF line ends, text fields in
 * double quotes (quotes doubled, no line breaks), amounts with a decimal comma and no thousands
 * separator, Windows-1252 encoding. Amounts in a currency other than EUR carry the exchange rate
 * ("Kurs": units of the currency per 1 EUR) and the EUR amount ("Basis-Umsatz").
 * https://developer.datev.de/de/file-format/details/datev-format/format-description
 */

export interface DatevSettings {
  consultantNumber: number;
  clientNumber: number;
  /** G/L account length, 4 to 8. */
  accountLength: number;
  /** First month of the fiscal year, 1 to 12. */
  fiscalYearStart: number;
  revenueAccount: string;
  debtorAccount: string;
  /** BU-Schlüssel; empty for revenue accounts with automatic tax. */
  taxKey: string | null;
}

/** EUR per 1 USD for a statement month, to convert amounts in other currencies to EUR. */
export type EurPerUsd = (period: string) => number | null;

const BASE = "EUR";

/** Amount with decimal comma and two decimals, no thousands separator: 1234,50 */
export function datevAmount(n: number): string {
  return Math.abs(n).toFixed(2).replace(".", ",");
}

/** Exchange rate with decimal comma and six decimals. */
export function datevRate(n: number): string {
  return n.toFixed(6).replace(".", ",");
}

/** A text field: quoted, inner quotes doubled, control characters removed, cut to `max`. */
export function datevText(v: string, max = 60): string {
  const clean = v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
  return `"${clean.replace(/"/g, '""')}"`;
}

const ddmm = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}`;
const ddmmyyyy = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}`;
const yyyymmdd = (day: string) => day.replaceAll("-", "");

/** First day (YYYY-MM-DD) of the fiscal year that contains `day`. */
export function fiscalYearStartOf(day: string, startMonth: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const year = m >= startMonth ? y : y - 1;
  return `${year}-${String(startMonth).padStart(2, "0")}-01`;
}

/** Timestamp YYYYMMDDHHMMSSFFF (UTC). */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
}

export type DatevResult = { ok: true; bytes: Uint8Array; text: string; count: number } | { ok: false; error: string };

export function datevBuchungsstapel(
  invoices: readonly ExportInvoice[],
  settings: DatevSettings,
  opts: { period: string; eurPerUsd: EurPerUsd; now: Date },
): DatevResult {
  if (invoices.length === 0) return { ok: false, error: "No closed, sent or paid statements with an amount for this month." };
  const days = invoices.map((i) => i.issueDate).sort();
  const from = days[0]!;
  const to = days.at(-1)!;
  // "Belegdatum" has no year: DATEV takes it from the fiscal year in the header, so one file holds one fiscal year.
  const fy = fiscalYearStartOf(from, settings.fiscalYearStart);
  if (fiscalYearStartOf(to, settings.fiscalYearStart) !== fy) {
    return { ok: false, error: "The statements of this month were issued in different fiscal years. Export them in separate files." };
  }
  const [py, pm] = opts.period.split("-");
  const header = [
    '"EXTF"',
    "700",
    "21",
    '"Buchungsstapel"',
    "13",
    stamp(opts.now),
    "",
    '""',
    '""',
    '""',
    String(settings.consultantNumber),
    String(settings.clientNumber),
    yyyymmdd(fy),
    String(settings.accountLength),
    yyyymmdd(from),
    yyyymmdd(to),
    `"Statements ${pm}/${py}"`,
    '""',
    "1",
    "0",
    "0",
    `"${BASE}"`,
    "",
    '""',
    "",
    "",
    '""',
    "",
    "",
    '""',
    '""',
  ];

  const col = (name: (typeof DATEV_COLUMNS)[number]) => DATEV_COLUMNS.indexOf(name);
  const rows: string[] = [];
  for (const inv of invoices) {
    const r: string[] = DATEV_COLUMNS.map(() => "");
    r[col("Umsatz (ohne Soll/Haben-Kz)")] = datevAmount(inv.total);
    // A statement is a receivable: debit the debtor; a negative total would be a credit.
    r[col("Soll/Haben-Kennzeichen")] = inv.total >= 0 ? '"S"' : '"H"';
    r[col("WKZ Umsatz")] = `"${inv.currency}"`;
    if (inv.currency !== BASE) {
      const eur = opts.eurPerUsd(inv.period);
      const perUsd = inv.currency === "USD" ? 1 : inv.fx?.perUsd;
      if (!eur || !perUsd) return { ok: false, error: `No EUR exchange rate for ${inv.period} to convert ${inv.number} (${inv.currency}).` };
      // Kurs: units of the statement currency per 1 EUR.
      const kurs = Math.round((perUsd / eur) * 1e6) / 1e6;
      r[col("Kurs")] = datevRate(kurs);
      r[col("Basis-Umsatz")] = datevAmount(inv.total / kurs);
      r[col("WKZ Basis-Umsatz")] = `"${BASE}"`;
    }
    r[col("Konto")] = settings.debtorAccount;
    r[col("Gegenkonto (ohne BU-Schlüssel)")] = settings.revenueAccount;
    r[col("BU-Schlüssel")] = settings.taxKey ? `"${settings.taxKey}"` : '""';
    r[col("Belegdatum")] = ddmm(inv.issueDate);
    r[col("Belegfeld 1")] = datevText(inv.number.replace(/[^\w$&%*+\-/]/g, ""), 36);
    r[col("Buchungstext")] = datevText(`${inv.clientName} ${inv.number}`);
    r[col("Fälligkeit")] = ddmmyyyy(inv.dueDate);
    rows.push(r.join(";"));
  }
  const text = [header.join(";"), DATEV_COLUMNS.join(";"), ...rows].join("\r\n") + "\r\n";
  return { ok: true, bytes: encodeCp1252(text), text, count: rows.length };
}

/** File name as DATEV expects it: EXTF_ prefix, .csv. */
export function datevFileName(period: string): string {
  return `EXTF_Buchungsstapel_LLMpense_${period}.csv`;
}
