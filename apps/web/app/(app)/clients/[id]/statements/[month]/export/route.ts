import { parsePeriod } from "@llmpense/core";
import { requireAdmin } from "@/lib/auth.ts";
import { csvResponse, statementCsv } from "@/lib/statement-csv.ts";
import { clientStatement } from "@/lib/statements.ts";

export const dynamic = "force-dynamic";

/** Line items of one statement as CSV. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; month: string }> }) {
  const org = await requireAdmin().catch(() => null);
  if (!org) return new Response("Not signed in", { status: 401 });
  const { id, month } = await params;
  if (!parsePeriod(month)) return new Response("month must be YYYY-MM", { status: 400 });
  const s = await clientStatement(org.id, id, month);
  if (!s) return new Response("Client not found", { status: 404 });
  return csvResponse(statementCsv(s), `llmpense-statement-${s.client.slug}-${month}.csv`);
}
