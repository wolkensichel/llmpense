import { parsePeriod } from "@llmpense/core";
import { requireAdmin } from "@/lib/auth.ts";
import { datevBuchungsstapel, datevFileName } from "@/lib/accounting/datev.ts";
import { exportInvoices, fileResponse } from "@/lib/accounting/export.ts";
import { accountingSettingsOf, missingForDatev } from "@/lib/accounting/settings.ts";
import { getFx } from "@/lib/fx.ts";
import { monthStatements } from "@/lib/statements.ts";

export const dynamic = "force-dynamic";

/** DATEV Buchungsstapel (EXTF, Windows-1252) for a month (`?month=YYYY-MM`): closed, sent and paid statements. */
export async function GET(req: Request) {
  const org = await requireAdmin().catch(() => null);
  if (!org) return new Response("Not signed in", { status: 401 });
  const month = new URL(req.url).searchParams.get("month");
  if (!parsePeriod(month)) return new Response("month must be YYYY-MM", { status: 400 });
  const s = accountingSettingsOf(org);
  const missing = missingForDatev(s);
  if (missing.length) return new Response(`Set the ${missing.join(", ")} under Settings > Accounting export first.`, { status: 409 });
  const now = new Date();
  const [list, fx] = await Promise.all([monthStatements(org.id, month!, now), getFx(org.id, [month!], now)]);
  const invoices = exportInvoices(org, list);
  const r = datevBuchungsstapel(
    invoices,
    {
      consultantNumber: s.datevConsultantNumber!,
      clientNumber: s.datevClientNumber!,
      accountLength: s.datevAccountLength,
      fiscalYearStart: s.datevFiscalYearStart,
      revenueAccount: s.datevRevenueAccount!,
      debtorAccount: s.datevDebtorAccount!,
      taxKey: s.datevTaxKey,
    },
    // EUR per USD of the month, to state amounts in other currencies in EUR as well.
    { period: month!, eurPerUsd: (p) => fx("EUR", p)?.perUsd ?? null, now },
  );
  if (!r.ok) return new Response(r.error, { status: 409 });
  return fileResponse(r.bytes, datevFileName(month!), "text/csv; charset=windows-1252");
}
