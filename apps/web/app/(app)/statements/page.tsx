import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, TriangleAlert } from "lucide-react";
import { canClose, isoDay, isOverdue, periodOf, shiftPeriod, parsePeriod } from "@llmpense/core";
import type { ClientStatement } from "@llmpense/db";
import { getCurrentOrg } from "@/lib/org.ts";
import { monthStatements } from "@/lib/statements.ts";
import { resolvePeriod } from "@/lib/period.ts";
import { monthLabel, shortDate, usd } from "@/lib/format.ts";
import { BillingBadge, EmptyState, LossTag, MarginValue, PageHeader, Panel } from "@/components/ui.tsx";
import { billedText, CurrencyTag, MonthSwitcher, StatusBadge } from "@/components/statement.tsx";
import { ConfirmForm } from "@/components/confirm-form.tsx";
import { BulkMark, SelectAllStatements, SelectStatement } from "@/components/bulk-mark.tsx";
import { exportInvoices } from "@/lib/accounting/export.ts";
import { accountingSettingsOf, missingForDatev, missingForXero } from "@/lib/accounting/settings.ts";
import { closeAllDraftsAction, markSelectedAction } from "./actions.ts";

const FILTERS = [
  ["all", "All"],
  ["draft", "Draft"],
  ["closed", "Closed"],
  ["sent", "Sent"],
  ["overdue", "Overdue"],
  ["paid", "Paid"],
] as const;
type Filter = (typeof FILTERS)[number][0];

export const metadata: Metadata = { title: "Monthly statements" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function StatementsPage({ searchParams }: { searchParams: SP }) {
  const now = new Date();
  const current = periodOf(now);
  // Default to last month: the one that is ready to close.
  const sp = await searchParams;
  const period = resolvePeriod(sp.month, shiftPeriod(current, -1), now);
  const filter: Filter = FILTERS.some(([k]) => k === sp.status) ? (sp.status as Filter) : "all";
  const org = await getCurrentOrg();
  const all = await monthStatements(org.id, period, now);
  const today = isoDay(now);
  const overdueOf = (s: ClientStatement) => isOverdue(s.status, s.invoice.dueDate, today);
  const matches = (s: ClientStatement, f: Filter) => f === "all" || (f === "overdue" ? overdueOf(s) : s.status === f);
  const list = all.filter((s) => matches(s, filter));
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter((s) => matches(s, k)).length])) as Record<Filter, number>;
  const markable = all.some((s) => s.status === "closed" || s.status === "sent");
  const filterHref = (f: Filter) => `/statements?month=${period}${f === "all" ? "" : `&status=${f}`}`;
  const acct = accountingSettingsOf(org);
  const missingXero = missingForXero(acct);
  const missingDatev = missingForDatev(acct);
  const exportable = exportInvoices(org, all).length;

  const drafts = all.filter((s) => s.status === "draft");
  const ready = drafts.filter((s) => s.data.fx !== null).length;
  const missingRate = drafts.length - ready;
  const closable = canClose(period, now).ok;
  const sum = (xs: ClientStatement[], f: (s: ClientStatement) => number) => xs.reduce((a, s) => a + f(s), 0);
  const billed = sum(all, (s) => s.data.totals.totalBilledUsd);
  const cost = sum(all, (s) => s.data.totals.costUsd);
  const fees = sum(all, (s) => s.data.totals.fixedFeeUsd);
  const foreign = all.some((s) => s.data.terms.currency !== "USD");
  // The table footer sums the rows shown.
  const shown = {
    billed: sum(list, (s) => s.data.totals.totalBilledUsd),
    cost: sum(list, (s) => s.data.totals.costUsd),
    fees: sum(list, (s) => s.data.totals.fixedFeeUsd),
    foreign: list.some((s) => s.data.terms.currency !== "USD"),
  };

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <Link href="/clients" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft size={16} aria-hidden /> Clients
        </Link>
        <PageHeader
          title="Monthly statements"
          sub="What each client is billed per calendar month (UTC), in its billing currency. Closing a month freezes its numbers and exchange rate."
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <MonthSwitcher period={period} current={current} href={(p) => `/statements?month=${p}`} />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <a href={`/statements/export?month=${period}`} className="btn btn-quiet" download>
            <Download size={16} aria-hidden /> Month CSV
          </a>
          {closable && ready > 0 ? (
            <ConfirmForm
              action={closeAllDraftsAction}
              fields={{ period }}
              icon="lock"
              label={ready === 1 ? "Close 1 draft" : `Close all ${ready} drafts`}
              title={`Close ${ready === 1 ? "1 draft" : `${ready} drafts`} for ${monthLabel(period)}?`}
              body={`Totals, line items and exchange rates are frozen for ${ready === 1 ? "this client" : "each client"}; later usage, price or billing changes won't affect ${ready === 1 ? "the statement. You can reopen it." : "these statements. You can reopen each one."}`}
              confirmLabel={ready === 1 ? "Close draft" : `Close ${ready} drafts`}
            />
          ) : (
            <span className="inline-flex min-h-11 items-center justify-center text-center text-[13px] text-ink-3 sm:px-2">
              {!closable ? "Month still running" : drafts.length ? "Waiting for exchange rates" : "All closed"}
            </span>
          )}
        </div>
      </div>

      {closable && missingRate > 0 && (
        <p role="status" className="flex items-start gap-2 rounded-lg border border-line bg-loss-soft px-3 py-2.5 text-[13px] text-loss-ink">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {missingRate === 1 ? "One draft has" : `${missingRate} drafts have`} no exchange rate for {monthLabel(period)} and can&apos;t be closed yet.
            Run <code>pnpm fx:sync</code> or add a manual rate under Settings &gt; Exchange rates.
          </span>
        </p>
      )}

      <section aria-label="Month totals in USD" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Billed to clients" value={usd(billed)} sub={fees > 0 ? `incl. ${usd(fees)} fixed fees${foreign ? ", in USD" : ""}` : foreign ? "in USD" : undefined} />
        <Tile label="Provider cost" value={usd(cost)} />
        <Tile label="Margin" value={usd(billed - cost)} loss={billed - cost < 0} />
        <Tile
          label="Closed"
          value={`${all.length - drafts.length} of ${all.length}`}
          sub={
            [
              drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"}` : "",
              counts.sent ? `${counts.sent} sent` : "",
              counts.overdue ? `${counts.overdue} overdue` : "",
              counts.paid ? `${counts.paid} paid` : "",
            ]
              .filter(Boolean)
              .join(", ") || "Month closed"
          }
        />
      </section>

      <nav aria-label="Filter by status" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={filterHref(k)}
            aria-current={filter === k ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm ${
              filter === k ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            {label}
            <span className={`num text-[12px] ${k === "overdue" && counts.overdue ? "font-semibold text-loss-ink" : "text-ink-3"}`}>{counts[k]}</span>
          </Link>
        ))}
      </nav>

      {markable && (
        <BulkMark
          period={period}
          monthLabel={monthLabel(period)}
          today={today}
          minIssueDate={isoDay(parsePeriod(period)!.end)}
          markAction={markSelectedAction}
        />
      )}

      {all.length === 0 ? (
        <EmptyState title="No clients yet" />
      ) : list.length === 0 ? (
        <EmptyState title="No statements with this status">
          <Link href={filterHref("all")} className="font-medium text-accent hover:underline">
            Show all statements
          </Link>
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {list.map((s) => {
              const t = s.data.totals;
              const other = s.data.terms.currency !== "USD";
              return (
                <li key={s.client.id} className="flex rounded-xl border border-line bg-surface">
                  {(s.status === "closed" || s.status === "sent") && (
                    <label className="flex w-12 shrink-0 cursor-pointer items-start justify-center pt-4">
                      <SelectStatement clientId={s.client.id} status={s.status} label={`Select ${s.client.name}`} />
                    </label>
                  )}
                  <Link
                    href={`/clients/${s.client.id}/statements/${period}`}
                    className={`block min-w-0 flex-1 p-4 active:bg-surface-2 ${s.status === "closed" || s.status === "sent" ? "pl-0" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.client.name}</p>
                        {s.invoice.number && <p className="num truncate text-[12px] text-ink-3">{s.invoice.number}{dueText(s)}</p>}
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <StatusBadge status={s.status} overdue={overdueOf(s)} />
                          <BillingBadge mode={s.data.terms.billingMode} />
                          <CurrencyTag currency={s.data.terms.currency} />
                          {t.marginUsd < 0 && <LossTag />}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <div className="text-right">
                          <p className="num text-[17px] font-semibold">{billedText(t.totalBilled, s.data)}</p>
                          <p className="num text-[12px] text-ink-3">{other ? `${usd(t.totalBilledUsd)} USD` : "billed"}</p>
                        </div>
                        <ChevronRight size={18} className="mt-1 text-ink-3" aria-hidden />
                      </div>
                    </div>
                    <dl className="num mt-3 grid grid-cols-3 gap-2 text-[13px]">
                      <div>
                        <dt className="text-ink-3">Cost</dt>
                        <dd>{usd(t.costUsd)}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Fixed fee</dt>
                        <dd>{s.data.terms.billingMode === "fixed" ? billedText(t.fixedFee, s.data) : "–"}</dd>
                      </div>
                      <div>
                        <dt className="text-ink-3">Margin</dt>
                        <dd>
                          <MarginValue value={t.marginUsd} />
                        </dd>
                      </div>
                    </dl>
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface lg:block">
            <table className="dtable">
              <thead>
                <tr>
                  <th className="w-12 pr-0">
                    {markable && (
                      <label className="-m-3 flex size-11 cursor-pointer items-center justify-center">
                        <SelectAllStatements />
                      </label>
                    )}
                  </th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Statement</th>
                  <th className="r">Provider cost</th>
                  <th className="r hidden xl:table-cell">Fixed fee</th>
                  <th className="r">Total billed</th>
                  <th className="r hidden xl:table-cell">USD equivalent</th>
                  <th className="r">Margin</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const t = s.data.totals;
                  const late = overdueOf(s);
                  return (
                    <tr key={s.client.id}>
                      <td className="pr-0">
                        {(s.status === "closed" || s.status === "sent") && (
                          <label className="-m-3 flex size-11 cursor-pointer items-center justify-center">
                            <SelectStatement clientId={s.client.id} status={s.status} label={`Select ${s.client.name}`} />
                          </label>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Link href={`/clients/${s.client.id}/statements/${period}`} className="font-medium hover:underline">
                            {s.client.name}
                          </Link>
                          {t.marginUsd < 0 && <LossTag />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <BillingBadge
                            mode={s.data.terms.billingMode}
                            markupPct={s.data.terms.markupPct}
                            fixedFee={s.data.terms.fixedFee}
                            currency={s.data.terms.currency}
                          />
                          <CurrencyTag currency={s.data.terms.currency} />
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1.5">
                          <StatusBadge status={s.status} overdue={late} />
                        </div>
                      </td>
                      <td className="num whitespace-nowrap">
                        {s.invoice.number && s.status !== "draft" ? (
                          <>
                            <span className="block">{s.invoice.number}</span>
                            <span className={`block text-[12px] ${late ? "font-medium text-loss-ink" : "text-ink-3"}`}>
                              {s.status === "paid" ? "Paid" : `Due ${shortDate(s.invoice.dueDate!)}`}
                            </span>
                          </>
                        ) : (
                          <span className="text-ink-3">{s.invoice.number ? `${s.invoice.number} (reopened)` : "–"}</span>
                        )}
                      </td>
                      <td className="r">{usd(t.costUsd)}</td>
                      <td className="r hidden xl:table-cell">{s.data.terms.billingMode === "fixed" ? billedText(t.fixedFee, s.data) : "–"}</td>
                      <td className="r font-medium">{billedText(t.totalBilled, s.data)}</td>
                      <td className="r hidden text-ink-2 xl:table-cell">{usd(t.totalBilledUsd)}</td>
                      <td className="r">
                        <MarginValue value={t.marginUsd} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-medium">
                  <td className="px-3 py-2.5" colSpan={4}>
                    Total (USD){filter !== "all" && <span className="font-normal text-ink-3">, {list.length} shown</span>}
                  </td>
                  <td className="r px-3">{usd(shown.cost)}</td>
                  <td className="r hidden px-3 xl:table-cell">{usd(shown.fees)}</td>
                  <td className="r px-3">
                    {/* Without the USD column (narrower screens) this cell carries the USD total. */}
                    <span className="xl:hidden">{usd(shown.billed)}</span>
                    <span className="hidden text-ink-3 xl:inline">{shown.foreign ? "mixed currencies" : usd(shown.billed)}</span>
                  </td>
                  <td className="r hidden px-3 xl:table-cell">{usd(shown.billed)}</td>
                  <td className="r px-3">
                    <MarginValue value={shown.billed - shown.cost} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <AccountingExport period={period} exportable={exportable} missingXero={missingXero} missingDatev={missingDatev} />

      <p className="text-[13px] text-ink-3">
        Drafts are computed live; a month can be closed once it has ended. The running month bills fixed fees prorated to date and uses the
        latest exchange rate; an ended month uses the rate of its last business day. Provider cost, USD equivalents and margins are in USD.
      </p>
    </div>
  );
}

function dueText(s: ClientStatement): string {
  if (s.status === "paid") return " · paid";
  if (s.status === "draft" || !s.invoice.dueDate) return "";
  return ` · due ${shortDate(s.invoice.dueDate)}`;
}

/** Xero and DATEV files for the month, or what has to be set up first. */
function AccountingExport({
  period,
  exportable,
  missingXero,
  missingDatev,
}: {
  period: string;
  exportable: number;
  missingXero: string[];
  missingDatev: string[];
}) {
  const settings = (
    <Link href="/settings#accounting-export" className="font-medium text-accent hover:underline">
      Settings &gt; Accounting export
    </Link>
  );
  const item = (name: string, href: string, missing: string[], detail: string) => {
    const ready = missing.length === 0 && exportable > 0;
    return (
      <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">{name}</p>
          <p className="text-[13px] text-ink-3">
            {missing.length ? (
              <>
                Set the {missing.join(", ")} under {settings} first.
              </>
            ) : (
              detail
            )}
          </p>
        </div>
        {ready ? (
          <a href={`${href}?month=${period}`} className="btn btn-quiet shrink-0" download>
            <Download size={16} aria-hidden /> {name}
          </a>
        ) : (
          <span aria-disabled="true" className="btn btn-quiet shrink-0 cursor-not-allowed opacity-50">
            <Download size={16} aria-hidden /> {name}
          </span>
        )}
      </li>
    );
  };
  return (
    <Panel
      title="Accounting export"
      sub={
        exportable
          ? `${exportable} closed, sent or paid statement${exportable === 1 ? "" : "s"} with an amount, one invoice each, with number, issue and due date.`
          : "Close statements first: only closed, sent and paid statements with an amount are exported."
      }
    >
      <ul className="divide-y divide-line">
        {item("Xero CSV", "/statements/export/xero", missingXero, "Sales > Invoices > Import. Choose tax exclusive amounts; invoices import as drafts.")}
        {item("DATEV Buchungsstapel", "/statements/export/datev", missingDatev, "EXTF file for DATEV Rechnungswesen, one posting per statement, Windows-1252.")}
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink-3">
        Lexware Office has no file import for sales invoices; upload the statement PDFs in its receipt capture.
      </p>
    </Panel>
  );
}

function Tile({ label, value, sub, loss = false }: { label: string; value: string; sub?: string; loss?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5 lg:p-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className={`num mt-1 text-[20px] leading-7 font-semibold tracking-tight lg:text-[24px] lg:leading-8 ${loss ? "text-loss-ink" : ""}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-ink-3">{sub}</p>}
    </div>
  );
}
