import { parsePeriod } from "@llmpense/core";
import { requireAdmin } from "@/lib/auth.ts";
import { exportInvoices, fileResponse } from "@/lib/accounting/export.ts";
import { accountingSettingsOf, missingForXero } from "@/lib/accounting/settings.ts";
import { xeroCsv } from "@/lib/accounting/xero.ts";
import { monthStatements } from "@/lib/statements.ts";

export const dynamic = "force-dynamic";

/** Xero sales invoice import CSV for a month (`?month=YYYY-MM`): closed, sent and paid statements. */
export async function GET(req: Request) {
  const org = await requireAdmin().catch(() => null);
  if (!org) return new Response("Not signed in", { status: 401 });
  const month = new URL(req.url).searchParams.get("month");
  if (!parsePeriod(month)) return new Response("month must be YYYY-MM", { status: 400 });
  const settings = accountingSettingsOf(org);
  const missing = missingForXero(settings);
  if (missing.length) return new Response(`Set the ${missing.join(" and ")} under Settings > Accounting export first.`, { status: 409 });
  const invoices = exportInvoices(org, await monthStatements(org.id, month!));
  if (invoices.length === 0) return new Response("No closed, sent or paid statements with an amount for this month.", { status: 404 });
  const csv = xeroCsv(invoices, { accountCode: settings.xeroAccountCode!, taxType: settings.xeroTaxType! });
  return fileResponse(csv, `xero-invoices-${month}.csv`, "text/csv; charset=utf-8");
}
