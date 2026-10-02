import { requireAdmin } from "@/lib/auth.ts";
import { toCsv } from "@/lib/csv.ts";
import { proratedFixedFee } from "@/lib/margin.ts";
import { clientMonthUsage, getClient } from "@/lib/queries.ts";
import { parseMonth } from "@/lib/range.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const org = await requireAdmin().catch(() => null);
  if (!org) return new Response("Not signed in", { status: 401 });
  const { id } = await params;
  const client = await getClient(org.id, id);
  if (!client) return new Response("Client not found", { status: 404 });

  const monthParam = new URL(req.url).searchParams.get("month");
  const month = parseMonth(monthParam);
  if (!month) return new Response("month must be YYYY-MM", { status: 400 });

  const rows = await clientMonthUsage(org.id, client.id, month.start, month.end);
  const header = [
    "month",
    "client",
    "project",
    "provider",
    "model",
    "requests",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_write_tokens",
    "cost_usd",
    "billed_usd",
  ];
  const lines: (string | number)[][] = rows.map((r) => [
    monthParam!,
    client.name,
    r.project,
    r.provider,
    r.model,
    r.requests,
    r.inputTokens,
    r.outputTokens,
    r.cacheReadTokens,
    r.cacheWriteTokens,
    r.cost.toFixed(6),
    r.billed.toFixed(6),
  ]);
  const sum = (k: "requests" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "cost" | "billed") =>
    rows.reduce((a, r) => a + r[k], 0);
  // A whole calendar month earns the full fee, by the same rule the dashboards use.
  const feeTotal = client.billingMode === "fixed" ? proratedFixedFee(client.fixedFeeUsd, month.start, month.end) : 0;
  if (client.billingMode === "fixed") {
    lines.push([monthParam!, client.name, "Fixed monthly fee", "", "", "", "", "", "", "", "", feeTotal.toFixed(2)]);
  }
  lines.push([
    monthParam!,
    client.name,
    "Total",
    "",
    "",
    sum("requests"),
    sum("inputTokens"),
    sum("outputTokens"),
    sum("cacheReadTokens"),
    sum("cacheWriteTokens"),
    sum("cost").toFixed(6),
    (sum("billed") + feeTotal).toFixed(6),
  ]);

  const filename = `llmpense-${client.slug}-${monthParam}.csv`;
  return new Response(toCsv([header, ...lines]), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
