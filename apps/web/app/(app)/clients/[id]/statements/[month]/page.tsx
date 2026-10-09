import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, FileText, LockOpen, Lock } from "lucide-react";
import { canClose, parsePeriod, periodOf } from "@llmpense/core";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientStatement } from "@/lib/statements.ts";
import { dateTime, longDate, monthLabel, pct, usd } from "@/lib/format.ts";
import { BillingBadge, LossTag, Panel } from "@/components/ui.tsx";
import { MonthSwitcher, StatementLines, StatusBadge } from "@/components/statement.tsx";
import { closeStatementAction, reopenStatementAction } from "@/app/(app)/statements/actions.ts";

type Props = { params: Promise<{ id: string; month: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, month } = await params;
  const org = await getCurrentOrg();
  const s = parsePeriod(month) ? await clientStatement(org.id, id, month) : null;
  return { title: s ? `${s.client.name}, ${monthLabel(month)}` : "Statement" };
}

export default async function StatementPage({ params }: Props) {
  const { id, month } = await params;
  const now = new Date();
  const current = periodOf(now);
  if (!parsePeriod(month) || month > current) notFound();
  const org = await getCurrentOrg();
  const s = await clientStatement(org.id, id, month, now);
  if (!s) notFound();

  const t = s.data.totals;
  const terms = s.data.terms;
  const closable = canClose(month, now).ok;
  const base = `/clients/${s.client.id}/statements`;

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link href={`/clients/${s.client.id}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink">
            <ChevronLeft size={16} aria-hidden /> {s.client.name}
          </Link>
          <Link href={`/statements?month=${month}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
            All statements for {monthLabel(month)}
          </Link>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[24px] leading-8 font-semibold tracking-tight lg:text-[28px] lg:leading-9">Statement</h1>
          <StatusBadge status={s.status} />
          <BillingBadge mode={terms.billingMode} markupPct={terms.markupPct} fixedFeeUsd={terms.fixedFeeUsd} />
          {t.marginUsd < 0 && <LossTag />}
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {s.client.name}, {monthLabel(month)} (UTC)
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <MonthSwitcher period={month} current={current} href={(p) => `${base}/${p}`} />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Link href={`/statement/${s.client.id}/${month}`} className="btn btn-quiet">
            <FileText size={16} aria-hidden /> Client view
          </Link>
          <a href={`${base}/${month}/export`} className="btn btn-quiet" download>
            <Download size={16} aria-hidden /> CSV
          </a>
          {s.status === "closed" ? (
            <form action={reopenStatementAction} className="col-span-2 sm:col-span-1">
              <input type="hidden" name="clientId" value={s.client.id} />
              <input type="hidden" name="period" value={month} />
              <button className="btn btn-quiet w-full">
                <LockOpen size={16} aria-hidden /> Reopen
              </button>
            </form>
          ) : closable ? (
            <form action={closeStatementAction} className="col-span-2 sm:col-span-1">
              <input type="hidden" name="clientId" value={s.client.id} />
              <input type="hidden" name="period" value={month} />
              <button className="btn btn-primary w-full">
                <Lock size={16} aria-hidden /> Close statement
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <StatusNote status={s.status} closedAt={s.closedAt} reopenedAt={s.reopenedAt} closable={closable} coverage={s.data.feeCoverage} />

      <section aria-label="Totals" className="rounded-xl border border-line bg-surface p-4 lg:p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fig label="Provider cost" value={usd(t.costUsd)} />
          <Fig label="Billed for usage" value={usd(t.usageBilledUsd)} />
          <Fig
            label="Fixed fee"
            value={terms.billingMode === "fixed" ? usd(t.fixedFeeUsd) : "–"}
            sub={s.data.feeCoverage === "to_date" ? `of ${usd(terms.fixedFeeUsd)}, to date` : undefined}
          />
          <Fig label="Total billed" value={usd(t.totalBilledUsd)} strong />
          <Fig label="Margin" value={usd(t.marginUsd)} loss={t.marginUsd < 0} />
          <Fig label="Margin %" value={pct(t.marginPct)} loss={t.marginPct !== null && t.marginPct < 0} />
        </dl>
      </section>

      <Panel title="Line items" sub="Per project and model. Billed amounts are rounded to cents per line; the total is their sum.">
        <StatementLines data={s.data} />
      </Panel>
    </div>
  );
}

function StatusNote({
  status,
  closedAt,
  reopenedAt,
  closable,
  coverage,
}: {
  status: "draft" | "closed";
  closedAt: Date | null;
  reopenedAt: Date | null;
  closable: boolean;
  coverage: string;
}) {
  let text: string;
  if (status === "closed") {
    text = `Closed ${longDate(closedAt!)}. Totals and line items are frozen; later usage, price or billing changes don't affect them. Reopen to recompute.`;
  } else if (!closable) {
    text = `Draft, computed live. The month is still running${coverage === "to_date" ? ", so the fixed fee is prorated to date" : ""}. It can be closed once it ends.`;
  } else {
    text = `Draft, computed live from recorded usage and the client's current billing settings. Close it to freeze the numbers.`;
  }
  return (
    <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
      {text}
      {status === "draft" && reopenedAt && <> Reopened {dateTime(reopenedAt)} UTC.</>}
    </p>
  );
}

function Fig({ label, value, sub, loss = false, strong = false }: { label: string; value: string; sub?: string; loss?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd
        className={`num mt-0.5 text-[20px] leading-7 tracking-tight lg:text-[22px] ${strong ? "font-semibold" : "font-medium"} ${loss ? "text-loss-ink" : ""}`}
      >
        {value}
      </dd>
      {sub && <dd className="num text-[12px] text-ink-3">{sub}</dd>}
    </div>
  );
}
