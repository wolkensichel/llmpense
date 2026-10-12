import { parsePeriod, periodOf, showModelNames, statementFileName } from "@llmpense/core";
import { requireAdmin } from "@/lib/auth.ts";
import { brandingOf } from "@/lib/branding.ts";
import { clientStatement } from "@/lib/statements.ts";
import { fetchLogo, renderStatementPdf } from "@/lib/statement-pdf.ts";

export const dynamic = "force-dynamic";

/** The client-facing statement as an A4 PDF, e.g. ST-2026-0001-acme-retail-2026-09.pdf. */
export async function GET(_req: Request, { params }: { params: Promise<{ clientId: string; month: string }> }) {
  const org = await requireAdmin().catch(() => null);
  if (!org) return new Response("Not signed in", { status: 401 });
  const { clientId, month } = await params;
  const now = new Date();
  if (!parsePeriod(month) || month > periodOf(now)) return new Response("month must be YYYY-MM, not in the future", { status: 400 });
  const s = await clientStatement(org.id, clientId, month, now);
  if (!s) return new Response("Client not found", { status: 404 });
  const brand = brandingOf(org);
  const pdf = await renderStatementPdf({
    brand,
    logo: await fetchLogo(brand.logoUrl),
    clientName: s.client.name,
    status: s.status,
    invoice: s.invoice,
    data: s.data,
    showModelNames: showModelNames(org.showModelNames, s.client.modelNames),
    now,
  });
  const name = statementFileName({ number: s.status === "draft" ? null : s.invoice.number, clientSlug: s.client.slug, period: month, ext: "pdf" });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${s.status === "draft" ? `draft-${name}` : name}"`,
      "cache-control": "no-store",
    },
  });
}
