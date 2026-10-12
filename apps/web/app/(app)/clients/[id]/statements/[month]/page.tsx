import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, FileText } from "lucide-react";
import { canClose, parsePeriod, periodOf } from "@llmpense/core";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientStatement } from "@/lib/statements.ts";
import { dateTime, longDate, monthLabel, pct, usd } from "@/lib/format.ts";
import { BillingBadge, LossTag, Panel } from "@/components/ui.tsx";
import { billedText, CurrencyTag, MissingRate, MonthSwitcher, RateLine, StatementLines, StatusBadge } from "@/components/statement.tsx";
import { ConfirmForm } from "@/components/confirm-form.tsx";
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
  const foreign = terms.currency !== "USD";
  const closable = canClose(month, now).ok && s.data.fx !== null;
  const base = `/clients/${s.client.id}/statements`;
  const fields = { clientId: s.client.id, period: month };
  const usdSub = (v: number) => (foreign ? `${usd(v)} USD equivalent` : undefined);

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
          <BillingBadge mode={terms.billingMode} markupPct={terms.markupPct} fixedFee={terms.fixedFee} currency={terms.currency} />
          <CurrencyTag currency={terms.currency} />
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
            <ConfirmForm
              action={reopenStatementAction}
              fields={fields}
              className="col-span-2 sm:col-span-1"
              variant="quiet"
              icon="unlock"
              label="Reopen"
              title={`Reopen ${monthLabel(month)} for ${s.client.name}?`}
              body="The statement goes back to a live draft and will be recomputed from recorded usage, the current billing settings and the current exchange rate."
              confirmLabel="Reopen statement"
            />
          ) : closable ? (
            <ConfirmForm
              action={closeStatementAction}
              fields={fields}
              className="col-span-2 sm:col-span-1"
              icon="lock"
              label="Close statement"
              title={`Close ${monthLabel(month)} for ${s.client.name}?`}
              body={`Totals and line items are frozen${foreign ? ", together with the exchange rate" : ""}; later usage, price or billing changes won't affect this statement. You can reopen it.`}
              confirmLabel="Close statement"
            />
          ) : null}
        </div>
      </div>

      <MissingRate data={s.data} />
      <StatusNote status={s.status} closedAt={s.closedAt} reopenedAt={s.reopenedAt} closable={canClose(month, now).ok} coverage={s.data.feeCoverage} />

      <section aria-label="Totals" className="rounded-xl border border-line bg-surface p-4 lg:p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fig label="Provider cost" value={usd(t.costUsd)} />
          <Fig label="Billed for usage" value={billedText(t.usageBilled, s.data)} sub={usdSub(t.usageBilledUsd)} />
          <Fig
            label="Fixed fee"
            value={terms.billingMode === "fixed" ? billedText(t.fixedFee, s.data) : "–"}
            sub={
              terms.billingMode !== "fixed"
                ? undefined
                : s.data.feeCoverage === "to_date"
                  ? `of ${billedText(terms.fixedFee, s.data)}, to date`
                  : usdSub(t.fixedFeeUsd)
            }
          />
          <Fig label="Total billed" value={billedText(t.totalBilled, s.data)} sub={usdSub(t.totalBilledUsd)} strong />
          <Fig label="Margin" value={usd(t.marginUsd)} loss={t.marginUsd < 0} />
          <Fig label="Margin %" value={pct(t.marginPct)} loss={t.marginPct !== null && t.marginPct < 0} />
        </dl>
        {foreign && <RateLine fx={s.data.fx} className="mt-4 border-t border-line pt-3" />}
      </section>

      <Panel
        title="Line items"
        sub={`Per project and model. Billed amounts are rounded to the ${foreign ? `${terms.currency} minor unit` : "cent"} per line; the total is their sum. Provider cost and margin are in USD.`}
      >
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
    text = `Closed ${longDate(closedAt!)}. Totals, line items and the exchange rate are frozen; later usage, price or billing changes don't affect them. Reopen to recompute.`;
  } else if (!closable) {
    text = `Draft, computed live with the latest exchange rate. The month is still running${coverage === "to_date" ? ", so the fixed fee is prorated to date" : ""}. It can be closed once it ends.`;
  } else {
    text = `Draft, computed live from recorded usage, the client's current billing settings and the month's exchange rate. Close it to freeze the numbers.`;
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
