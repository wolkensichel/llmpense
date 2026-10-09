import { parsePeriod } from "@llmpense/core";
import { requireAdmin } from "@/lib/auth.ts";
import { csvResponse, monthCsv } from "@/lib/statement-csv.ts";
import { monthStatements } from "@/lib/statements.ts";

export const dynamic = "force-dynamic";

/** One row per client for a month (`?month=YYYY-MM`), for bookkeeping. */
export async function GET(req: Request) {
  const org = await requireAdmin().catch(() => null);
  if (!org) return new Response("Not signed in", { status: 401 });
  const month = new URL(req.url).searchParams.get("month");
  if (!parsePeriod(month)) return new Response("month must be YYYY-MM", { status: 400 });
  const list = await monthStatements(org.id, month!);
  return csvResponse(monthCsv(month!, list), `llmpense-statements-${month}.csv`);
}
