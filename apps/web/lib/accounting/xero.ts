import { toCsv } from "../csv.ts";
import { decimalDot, type ExportInvoice } from "./common.ts";

/**
 * Xero "Import customer invoices" CSV (Sales > Invoices > Import), in the column layout of Xero's
 * template. One row per invoice line; rows with the same InvoiceNumber form one invoice. Dates are
 * DD/MM/YYYY. UnitAmount is tax exclusive (choose that when importing); AccountCode and TaxType
 * must match the chart of accounts and tax rate names in Xero exactly. Invoices import as drafts.
 * https://central.xero.com/s/article/Import-customer-invoices
 */
export const XERO_COLUMNS = [
  "*ContactName",
  "EmailAddress",
  "POAddressLine1",
  "POAddressLine2",
  "POAddressLine3",
  "POAddressLine4",
  "POCity",
  "PORegion",
  "POPostalCode",
  "POCountry",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "InventoryItemCode",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "Discount",
  "*AccountCode",
  "*TaxType",
  "TrackingName1",
  "TrackingOption1",
  "TrackingName2",
  "TrackingOption2",
  "Currency",
  "BrandingTheme",
] as const;

/** YYYY-MM-DD -> DD/MM/YYYY */
export function xeroDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

export function xeroCsv(invoices: readonly ExportInvoice[], settings: { accountCode: string; taxType: string }): string {
  const rows: (string | number)[][] = [[...XERO_COLUMNS]];
  for (const inv of invoices) {
    for (const l of inv.lines) {
      const row: Record<(typeof XERO_COLUMNS)[number], string> = Object.fromEntries(XERO_COLUMNS.map((c) => [c, ""])) as never;
      row["*ContactName"] = inv.clientName;
      row["*InvoiceNumber"] = inv.number;
      row.Reference = `AI usage ${inv.period}`;
      row["*InvoiceDate"] = xeroDate(inv.issueDate);
      row["*DueDate"] = xeroDate(inv.dueDate);
      row["*Description"] = l.description;
      row["*Quantity"] = "1";
      row["*UnitAmount"] = decimalDot(l.amount, inv.currency);
      row["*AccountCode"] = settings.accountCode;
      row["*TaxType"] = settings.taxType;
      row.Currency = inv.currency;
      rows.push(XERO_COLUMNS.map((c) => row[c]));
    }
  }
  return toCsv(rows);
}
