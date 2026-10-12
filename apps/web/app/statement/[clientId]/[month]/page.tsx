import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import {
  aggregateLinesByProject,
  CURRENCY_NAMES,
  ECB_ACKNOWLEDGEMENT,
  parsePeriod,
  periodOf,
  rateNote,
  showModelNames,
  type StatementLine,
} from "@llmpense/core";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientStatement } from "@/lib/statements.ts";
import { brandingOf } from "@/lib/branding.ts";
import { compactNum, count, longDate, money, monthLabel } from "@/lib/format.ts";
import { PrintButton } from "@/components/print-button.tsx";

/**
 * Client-facing statement: only what the client is billed (no provider cost, no margin),
 * branded with the agency's details. On screen it is a paper sheet; printed it is a clean A4 page.
 */

type Props = { params: Promise<{ clientId: string; month: string }> };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clientId, month } = await params;
  const org = await getCurrentOrg();
  const s = await clientStatement(org.id, clientId, month);
  // The title becomes the default file name for "Save as PDF".
  return { title: { absolute: s ? `Statement ${month} ${s.client.name}` : "Statement" } };
}

const PRINT_CSS = `
@page { size: A4; margin: 14mm 14mm 16mm; }
@media print {
  html, body { background: #fff !important; color-scheme: light; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default async function ClientStatementPage({ params }: Props) {
  const { clientId, month } = await params;
  const now = new Date();
  const period = parsePeriod(month);
  if (!period || month > periodOf(now)) notFound();
  const org = await getCurrentOrg();
  const s = await clientStatement(org.id, clientId, month, now);
  if (!s) notFound();

  const brand = brandingOf(org);
  const { totals, terms, feeCoverage, fx } = s.data;
  // A display setting: closed statements keep their frozen lines; only how they are shown changes.
  const models = showModelNames(org.showModelNames, s.client.modelNames);
  const lines = models ? s.data.lines : aggregateLinesByProject(s.data.lines, terms.currency);
  const usage = lines.filter((l) => l.kind === "usage");
  const fee = lines.find((l) => l.kind === "fixed_fee");
  const lastDay = new Date(Math.min(period.end.getTime(), now.getTime()) - 1);
  const amt = (n: number | null) => (n === null ? "–" : money(n, terms.currency));
  const amountOf = (l: StatementLine) =>
    terms.billingMode === "fixed" ? "Included" : terms.billingMode === "absorbed" ? "No charge" : amt(l.billed);
  const note = rateNote(fx);

  return (
    <div className="min-h-dvh bg-bg pb-10 print:bg-white print:pb-0">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4 py-3 print:hidden">
        <Link
          href={`/clients/${s.client.id}/statements/${month}`}
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink"
        >
          <ChevronLeft size={16} aria-hidden /> Back to statement
        </Link>
        <PrintButton />
      </div>
      {s.status === "draft" && (
        <p className="mx-auto mb-3 max-w-[210mm] px-4 text-[13px] text-ink-2 print:hidden">
          This statement is a draft and may still change. Close it to freeze the numbers before sending.
        </p>
      )}
      {!fx && (
        <p role="status" className="mx-auto mb-3 max-w-[210mm] px-4 text-[13px] text-loss-ink print:hidden">
          No {terms.currency} exchange rate for {monthLabel(month)} yet, so amounts can't be shown. Run pnpm fx:sync or add a manual rate under
          Settings &gt; Exchange rates.
        </p>
      )}

      <article
        className="mx-auto max-w-[210mm] bg-white px-5 py-7 text-[13px] leading-[1.5] text-[#15171c] shadow-[0_1px_3px_rgba(16,24,40,0.12),0_0_0_1px_rgba(16,24,40,0.06)] sm:px-[14mm] sm:py-[14mm] print:max-w-none print:p-0 print:shadow-none"
        style={{ colorScheme: "light" }}
      >
        <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            {brand.logoUrl && (
              <img src={brand.logoUrl} alt="" className="mb-3 max-h-12 max-w-[180px] object-contain" />
            )}
            <p className="text-[17px] font-semibold tracking-tight">{brand.name}</p>
            {brand.address && <p className="mt-1 whitespace-pre-line text-[#4b4f58]">{brand.address}</p>}
          </div>
          <div className="sm:text-right">
            <h1 className="text-[22px] leading-7 font-semibold tracking-tight">
              Statement{s.status === "draft" && <span className="ml-2 align-middle text-[12px] font-medium tracking-normal text-[#8a5a00] uppercase">Draft</span>}
            </h1>
            <p className="text-[#4b4f58]">AI usage, {monthLabel(month)}</p>
          </div>
        </header>

        <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 border-y border-[#e3e6ea] py-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-[12px] text-[#767a83]">Client</dt>
            <dd className="font-medium">{s.client.name}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-[#767a83]">Period (UTC)</dt>
            <dd className="num">
              {longDate(period.start).replace(/, \d{4}$/, "")} – {longDate(lastDay)}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-[#767a83]">{s.status === "closed" ? "Issued" : "As of"}</dt>
            <dd className="num">{longDate(s.closedAt ?? now)}</dd>
          </div>
        </dl>

        <table className="mt-6 w-full border-collapse text-left">
          <thead className="text-[12px] text-[#767a83]">
            <tr className="border-b border-[#cfd4da]">
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="num py-2 pr-3 text-right font-medium">Requests</th>
              <th className="num hidden py-2 pr-3 text-right font-medium sm:table-cell print:table-cell">Tokens</th>
              <th className="num py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {usage.length === 0 && !fee && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-[#767a83]">
                  No AI usage in this period.
                </td>
              </tr>
            )}
            {usage.map((l, i) => (
              <tr key={i} className="border-b border-[#e3e6ea] break-inside-avoid">
                <td className="py-2 pr-3 align-top">
                  <span className="block font-medium">{l.project}</span>
                  {models && l.model && <span className="block text-[12px] text-[#767a83]">{l.model}</span>}
                </td>
                <td className="num py-2 pr-3 text-right align-top">{count(l.requests)}</td>
                <td className="num hidden py-2 pr-3 text-right align-top sm:table-cell print:table-cell">
                  {compactNum(l.inputTokens + l.outputTokens + l.cacheReadTokens + l.cacheWriteTokens)}
                </td>
                <td className="num py-2 text-right align-top whitespace-nowrap">{amountOf(l)}</td>
              </tr>
            ))}
            {fee && (
              <tr className="border-b border-[#e3e6ea] break-inside-avoid">
                <td className="py-2 pr-3" colSpan={2}>
                  <span className="block font-medium">{fee.project}</span>
                  <span className="block text-[12px] text-[#767a83]">
                    {feeCoverage === "to_date" ? `Prorated to ${longDate(now)} of ${amt(terms.fixedFee)} per month` : "Covers all AI usage in the period"}
                  </span>
                </td>
                <td className="hidden sm:table-cell print:table-cell" />
                <td className="num py-2 text-right align-top whitespace-nowrap">{amt(fee.billed)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-full max-w-[280px] break-inside-avoid">
          <dl className="num space-y-1">
            {fee && (
              <>
                <div className="flex justify-between gap-4 text-[#4b4f58]">
                  <dt>Usage</dt>
                  <dd>{amt(totals.usageBilled)}</dd>
                </div>
                <div className="flex justify-between gap-4 text-[#4b4f58]">
                  <dt>Fixed fee</dt>
                  <dd>{amt(totals.fixedFee)}</dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-4 border-t border-[#15171c] pt-2 text-[15px] font-semibold">
              <dt>Total ({terms.currency})</dt>
              <dd>{amt(totals.totalBilled)}</dd>
            </div>
          </dl>
        </div>
        {note && <p className="mt-2 text-right text-[11px] leading-4 text-[#767a83] break-inside-avoid">{note}</p>}

        <footer className="mt-12 border-t border-[#e3e6ea] pt-4 text-[12px] text-[#767a83] break-inside-avoid">
          {brand.footer && <p className="mb-2 whitespace-pre-line text-[#4b4f58]">{brand.footer}</p>}
          <p>
            {brand.name} · Statement for {s.client.name}, {monthLabel(month)}. Amounts in {CURRENCY_NAMES[terms.currency]} ({terms.currency}); usage is counted per calendar month in UTC.
          </p>
          {note && fx?.source === "ecb" && <p className="mt-1">{ECB_ACKNOWLEDGEMENT}</p>}
        </footer>
      </article>
    </div>
  );
}
