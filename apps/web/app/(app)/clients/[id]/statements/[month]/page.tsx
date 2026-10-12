import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download, FileDown, FileText } from "lucide-react";
import { canClose, daysOverdue, isoDay, isOverdue, parsePeriod, periodOf, type StatementStatus } from "@llmpense/core";
import { statementHistory, type InvoiceInfo } from "@llmpense/db";
import { getDb } from "@/lib/db.ts";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientStatement } from "@/lib/statements.ts";
import { dateTime, longDate, monthLabel, pct, usd } from "@/lib/format.ts";
import { BillingBadge, LossTag, Panel } from "@/components/ui.tsx";
import { billedText, CurrencyTag, MissingRate, MonthSwitcher, RateLine, StatementLines, StatusBadge } from "@/components/statement.tsx";
import { ConfirmForm } from "@/components/confirm-form.tsx";
import { closeStatementAction, markStatementAction, reopenStatementAction } from "@/app/(app)/statements/actions.ts";

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
  const history = await statementHistory(getDb(), org.id, s.client.id, month);
  const today = isoDay(now);
  const overdue = isOverdue(s.status, s.invoice.dueDate, today);

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
          <h1 className="text-[24px] leading-8 font-semibold tracking-tight lg:text-[28px] lg:leading-9">
            Statement{s.invoice.number && <span className="num"> {s.invoice.number}</span>}
          </h1>
          <StatusBadge status={s.status} overdue={overdue} />
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
          <a href={`/statement/${s.client.id}/${month}/pdf`} className="btn btn-quiet" download>
            <FileDown size={16} aria-hidden /> PDF
          </a>
          <a href={`${base}/${month}/export`} className="btn btn-quiet" download>
            <Download size={16} aria-hidden /> CSV
          </a>
          <LifecycleActions
            status={s.status}
            closable={closable}
            fields={fields}
            month={month}
            clientName={s.client.name}
            foreign={foreign}
            invoice={s.invoice}
            today={today}
          />
        </div>
      </div>

      <MissingRate data={s.data} />
      <StatusNote status={s.status} closedAt={s.closedAt} reopenedAt={s.reopenedAt} closable={canClose(month, now).ok} coverage={s.data.feeCoverage} />
      {s.status !== "draft" && <InvoiceDetails invoice={s.invoice} status={s.status} today={today} />}

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

      {history.length > 0 && (
        <Panel title="History" sub="Status changes of this statement (UTC).">
          <ol className="space-y-1.5 text-[14px]">
            {history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span>{HISTORY_LABELS[h.action]}</span>
                <span className="num text-[13px] text-ink-3">{dateTime(h.at)}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

const HISTORY_LABELS = {
  close: "Closed",
  reopen: "Reopened",
  mark_sent: "Marked as sent",
  mark_paid: "Marked as paid",
  unmark_sent: "Unmarked as sent",
  unmark_paid: "Unmarked as paid",
} as const;

const day = (iso: string) => longDate(new Date(`${iso}T00:00:00Z`));

function InvoiceDetails({ invoice, status, today }: { invoice: InvoiceInfo; status: StatementStatus; today: string }) {
  const late = daysOverdue(status, invoice.dueDate, today);
  return (
    <section aria-label="Statement number and dates" className="rounded-xl border border-line bg-surface p-4 lg:px-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px] sm:grid-cols-3 xl:grid-cols-5">
        <Detail label="Number" value={invoice.number ?? "–"} />
        <Detail label="Issue date" value={invoice.issueDate ? day(invoice.issueDate) : "–"} />
        <Detail
          label="Due date"
          value={invoice.dueDate ? day(invoice.dueDate) : "–"}
          sub={
            late > 0
              ? `${late} day${late === 1 ? "" : "s"} overdue`
              : invoice.paymentTermsDays !== null
                ? `${invoice.paymentTermsDays} days payment terms`
                : undefined
          }
          loss={late > 0}
        />
        <Detail label="Sent" value={invoice.sentAt ? `${dateTime(invoice.sentAt)} UTC` : "Not yet"} />
        <Detail label="Paid" value={invoice.paidAt ? `${dateTime(invoice.paidAt)} UTC` : "Not yet"} />
      </dl>
    </section>
  );
}

function Detail({ label, value, sub, loss = false }: { label: string; value: string; sub?: string; loss?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num font-medium">{value}</dd>
      {sub && <dd className={`text-[12px] ${loss ? "font-medium text-loss-ink" : "text-ink-3"}`}>{sub}</dd>}
    </div>
  );
}

/** The lifecycle buttons for the statement's status, each behind a confirmation. */
function LifecycleActions({
  status,
  closable,
  fields,
  month,
  clientName,
  foreign,
  invoice,
  today,
}: {
  status: StatementStatus;
  closable: boolean;
  fields: Record<string, string>;
  month: string;
  clientName: string;
  foreign: boolean;
  invoice: InvoiceInfo;
  today: string;
}) {
  const what = `${monthLabel(month)} for ${clientName}`;
  const name = invoice.number ?? what;
  const wide = "col-span-2 sm:col-span-1";
  if (status === "draft") {
    if (!closable) return null;
    return (
      <ConfirmForm
        action={closeStatementAction}
        fields={fields}
        className={wide}
        icon="lock"
        label="Close statement"
        title={`Close ${what}?`}
        body={`Totals and line items are frozen${foreign ? ", together with the exchange rate" : ""}; later usage, price or billing changes won't affect this statement.${invoice.number ? ` It keeps its number ${invoice.number}.` : " It gets the next statement number."} You can reopen it.`}
        confirmLabel="Close statement"
      />
    );
  }
  if (status === "closed") {
    return (
      <>
        <ConfirmForm
          action={reopenStatementAction}
          fields={fields}
          variant="quiet"
          icon="unlock"
          label="Reopen"
          title={`Reopen ${what}?`}
          body={`The statement goes back to a live draft and will be recomputed from recorded usage, the current billing settings and the current exchange rate. It keeps its number${invoice.number ? ` ${invoice.number}` : ""}; issue and due date are set again when you close it.`}
          confirmLabel="Reopen statement"
        />
        <ConfirmForm
          action={markStatementAction}
          fields={{ ...fields, action: "mark_sent" }}
          className={wide}
          icon="send"
          label="Mark as sent"
          title={`Mark ${name} as sent?`}
          body="Records that the statement went to the client. It can't be reopened until you unmark it. The due date follows from the issue date and the payment terms; after it, the statement shows as overdue."
          extra={
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Issue date</span>
              <input type="date" name="issueDate" min={isoDay(parsePeriod(month)!.end)} defaultValue={invoice.issueDate ?? today} className="field num" />
              <span className="mt-1 block text-[13px] text-ink-3">Defaults to the close date. Changing it moves the due date.</span>
            </label>
          }
          confirmLabel="Mark as sent"
        />
      </>
    );
  }
  if (status === "sent") {
    return (
      <>
        <ConfirmForm
          action={markStatementAction}
          fields={{ ...fields, action: "unmark_sent" }}
          variant="quiet"
          icon="undo"
          label="Unmark sent"
          title={`Unmark ${name} as sent?`}
          body="The statement goes back to closed and its sent date is cleared. Only do this if it did not reach the client; a closed statement can be reopened and changed."
          confirmLabel="Unmark sent"
        />
        <ConfirmForm
          action={markStatementAction}
          fields={{ ...fields, action: "mark_paid" }}
          className={wide}
          icon="check"
          label="Mark as paid"
          title={`Mark ${name} as paid?`}
          body="Records that the client paid this statement, with today's date. It no longer counts as overdue."
          confirmLabel="Mark as paid"
        />
      </>
    );
  }
  return (
    <ConfirmForm
      action={markStatementAction}
      fields={{ ...fields, action: "unmark_paid" }}
      variant="quiet"
      icon="undo"
      label="Unmark paid"
      title={`Unmark ${name} as paid?`}
      body="The statement goes back to sent and its payment date is cleared. If its due date has passed, it shows as overdue again."
      confirmLabel="Unmark paid"
    />
  );
}


function StatusNote({
  status,
  closedAt,
  reopenedAt,
  closable,
  coverage,
}: {
  status: StatementStatus;
  closedAt: Date | null;
  reopenedAt: Date | null;
  closable: boolean;
  coverage: string;
}) {
  let text: string;
  if (status === "closed") {
    text = `Closed ${longDate(closedAt!)}. Totals, line items and the exchange rate are frozen; later usage, price or billing changes don't affect them. Reopen to recompute, or mark it as sent once it went to the client.`;
  } else if (status === "sent" || status === "paid") {
    text = `${status === "sent" ? "Sent" : "Paid"}; closed ${longDate(closedAt!)}. The numbers stay frozen. To change them, unmark it step by step back to closed, then reopen it.`;
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
