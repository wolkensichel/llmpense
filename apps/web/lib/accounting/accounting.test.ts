import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toExportInvoices } from "./common.ts";
import { decodeCp1252, encodeCp1252 } from "./cp1252.ts";
import { DATEV_COLUMNS } from "./datev-columns.ts";
import { datevAmount, datevBuchungsstapel, datevText, fiscalYearStartOf, type DatevSettings } from "./datev.ts";
import { FIXTURE_EUR_PER_USD, FIXTURE_NOW, FIXTURE_PERIOD, FIXTURE_STATEMENTS } from "./fixtures.ts";
import { accountingSchema, missingForDatev, missingForXero } from "./settings.ts";
import { xeroCsv, xeroDate, XERO_COLUMNS } from "./xero.ts";

/**
 * Golden files: the exports for fixed statements are compared byte for byte with the files in
 * golden/. Run with UPDATE_GOLDEN=1 to rewrite them after an intended change, then review the diff.
 */
const golden = (name: string) => fileURLToPath(new URL(`./golden/${name}`, import.meta.url));
function matchGolden(name: string, bytes: Uint8Array) {
  if (process.env.UPDATE_GOLDEN) writeFileSync(golden(name), bytes);
  expect(Buffer.from(bytes).equals(readFileSync(golden(name))), `${name} differs from its golden file`).toBe(true);
}

const invoices = toExportInvoices(FIXTURE_STATEMENTS);

const DATEV: DatevSettings = {
  consultantNumber: 29098,
  clientNumber: 55003,
  accountLength: 4,
  fiscalYearStart: 1,
  revenueAccount: "8400",
  debtorAccount: "10000",
  taxKey: null,
};

describe("export invoices", () => {
  it("takes closed, sent and paid statements with an amount, one invoice each", () => {
    expect(invoices.map((i) => [i.number, i.currency, i.total])).toEqual([
      ["ST-2026-0001", "EUR", 148.97],
      ["ST-2026-0002", "USD", 1235.76],
      ["ST-2026-0003", "JPY", 20000],
    ]);
  });

  it("follows the model-name setting and drops zero lines", () => {
    expect(invoices[1]!.lines.map((l) => l.description)).toEqual(["AI usage Sep 2026: Product search", "AI usage Sep 2026: Support bot"]);
    expect(invoices[2]!.lines).toEqual([{ description: "Fixed monthly fee, Sep 2026", amount: 20000 }]);
    // Line amounts add up to the total.
    for (const inv of invoices) expect(inv.lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(inv.total, 6);
  });
});

describe("Xero sales invoice CSV", () => {
  const csv = xeroCsv(invoices, { accountCode: "200", taxType: "Tax Exempt" });

  it("matches the golden file", () => matchGolden("xero-2026-09.csv", new TextEncoder().encode(csv)));

  it("uses Xero's template columns, DD/MM/YYYY dates and one row per line", () => {
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(XERO_COLUMNS.join(","));
    expect(rows).toHaveLength(1 + invoices.reduce((a, i) => a + i.lines.length, 0));
    expect(xeroDate("2026-10-02")).toBe("02/10/2026");
    expect(csv).toContain(",ST-2026-0003,AI usage 2026-09,05/10/2026,04/11/2026,,\"Fixed monthly fee, Sep 2026\",1,20000,,200,Tax Exempt,,,,,JPY,");
  });
});

describe("DATEV Buchungsstapel", () => {
  const r = datevBuchungsstapel(invoices, DATEV, { period: FIXTURE_PERIOD, eurPerUsd: () => FIXTURE_EUR_PER_USD, now: FIXTURE_NOW });
  if (!r.ok) throw new Error(r.error);

  it("matches the golden file (Windows-1252)", () => matchGolden("EXTF_Buchungsstapel-2026-09.csv", r.bytes));

  it("writes the EXTF header, the 125 headings and one posting per statement", () => {
    const lines = r.text.split("\r\n");
    expect(lines.at(-1)).toBe("");
    expect(lines[0]).toBe(
      '"EXTF";700;21;"Buchungsstapel";13;20261012083015123;;"";"";"";29098;55003;20260101;4;20261002;20261005;"Statements 09/2026";"";1;0;0;"EUR";;"";;;"";;;"";""',
    );
    expect(lines[0]!.split(";")).toHaveLength(31);
    expect(lines[1]!.split(";")).toHaveLength(125);
    expect(DATEV_COLUMNS).toHaveLength(125);
    expect(lines.slice(2, -1)).toHaveLength(3);
    for (const l of lines.slice(2, -1)) expect(l.split(";")).toHaveLength(125);
  });

  it("uses decimal commas, the debit flag, accounts, DDMM dates and the statement number", () => {
    const [eur, usd, jpy] = r.text.split("\r\n").slice(2, 5).map((l) => l.split(";"));
    expect(eur!.slice(0, 14)).toEqual(["148,97", '"S"', '"EUR"', "", "", "", "10000", "8400", '""', "0210", '"ST-2026-0001"', "", "", '"Müller & Söhne GmbH ST-2026-0001"']);
    // Foreign currencies carry the rate per EUR and the EUR amount.
    expect(usd!.slice(0, 6)).toEqual(["1235,76", '"S"', '"USD"', "1,164958", "1060,78", '"EUR"']);
    expect(jpy!.slice(0, 6)).toEqual(["20000,00", '"S"', '"JPY"', "172,390494", "116,02", '"EUR"']);
    expect(jpy![DATEV_COLUMNS.indexOf("Fälligkeit")]).toBe("04112026");
  });

  it("encodes Windows-1252", () => {
    expect([...r.bytes].includes(0xfc)).toBe(true); // ü
    expect([...encodeCp1252("€")]).toEqual([0x80]);
    expect(decodeCp1252(r.bytes)).toBe(r.text);
  });

  it("formats amounts and text fields", () => {
    expect(datevAmount(1234.5)).toBe("1234,50");
    expect(datevAmount(0.1 + 0.2)).toBe("0,30");
    expect(datevText('Say "hi"\nnow')).toBe('"Say ""hi"" now"');
    expect(datevText("x".repeat(80))).toHaveLength(62);
  });

  it("refuses files spanning two fiscal years and months without a EUR rate", () => {
    expect(fiscalYearStartOf("2026-10-02", 4)).toBe("2026-04-01");
    expect(fiscalYearStartOf("2026-02-02", 4)).toBe("2025-04-01");
    const split = invoices.map((i, n) => ({ ...i, issueDate: n === 0 ? "2026-03-30" : "2026-04-02" }));
    expect(datevBuchungsstapel(split, { ...DATEV, fiscalYearStart: 4 }, { period: FIXTURE_PERIOD, eurPerUsd: () => 0.9, now: FIXTURE_NOW }).ok).toBe(false);
    expect(datevBuchungsstapel(invoices, DATEV, { period: FIXTURE_PERIOD, eurPerUsd: () => null, now: FIXTURE_NOW }).ok).toBe(false);
    expect(datevBuchungsstapel([], DATEV, { period: FIXTURE_PERIOD, eurPerUsd: () => null, now: FIXTURE_NOW }).ok).toBe(false);
  });
});

describe("accounting settings", () => {
  const base = { datevAccountLength: "4", datevFiscalYearStart: "1" };

  it("starts empty and says what is missing", () => {
    const v = accountingSchema.parse({ ...base, xeroAccountCode: "", datevRevenueAccount: " " });
    expect(v.xeroAccountCode).toBeNull();
    expect(missingForXero(v as never)).toEqual(["Xero account code", "Xero tax rate"]);
    expect(missingForDatev(v as never)).toEqual(["DATEV consultant number", "DATEV client number", "revenue account", "debtor account"]);
  });

  it("validates numbers and account lengths", () => {
    expect(accountingSchema.safeParse({ ...base, datevConsultantNumber: "29098", datevClientNumber: "55003", datevRevenueAccount: "8400", datevDebtorAccount: "10000", datevTaxKey: "3" }).success).toBe(true);
    expect(accountingSchema.safeParse({ ...base, datevConsultantNumber: "999" }).success).toBe(false);
    expect(accountingSchema.safeParse({ ...base, datevClientNumber: "100000" }).success).toBe(false);
    expect(accountingSchema.safeParse({ ...base, datevRevenueAccount: "84000" }).success).toBe(false);
    expect(accountingSchema.safeParse({ ...base, datevRevenueAccount: "0840" }).success).toBe(false);
    expect(accountingSchema.safeParse({ ...base, datevDebtorAccount: "100000" }).success).toBe(false);
    expect(accountingSchema.safeParse({ ...base, datevTaxKey: "12345" }).success).toBe(false);
  });
});
