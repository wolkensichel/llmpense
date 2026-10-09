import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import { canClose, periodOf, shiftPeriod } from "@llmpense/core";
import type { ClientStatement } from "@llmpense/db";
import { getCurrentOrg } from "@/lib/org.ts";
import { monthStatements } from "@/lib/statements.ts";
import { resolvePeriod } from "@/lib/period.ts";
import { usd } from "@/lib/format.ts";
import { BillingBadge, EmptyState, LossTag, MarginValue, PageHeader } from "@/components/ui.tsx";
import { MonthSwitcher, StatusBadge } from "@/components/statement.tsx";
import { closeAllDraftsAction } from "./actions.ts";

export const metadata: Metadata = { title: "Monthly statements" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function StatementsPage({ searchParams }: { searchParams: SP }) {
  const now = new Date();
  const current = periodOf(now);
  // Default to last month: the one that is ready to close.
  const period = resolvePeriod((await searchParams).month, shiftPeriod(current, -1), now);
  const org = await getCurrentOrg();
  const list = await monthStatements(org.id, period, now);

  const drafts = list.filter((s) => s.status === "draft").length;
  const closable = canClose(period, now).ok;
  const sum = (f: (s: ClientStatement) => number) => list.reduce((a, s) => a + f(s), 0);
  const billed = sum((s) => s.data.totals.totalBilledUsd);
  const cost = sum((s) => s.data.totals.costUsd);
  const fees = sum((s) => s.data.totals.fixedFeeUsd);

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <Link href="/clients" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft size={16} aria-hidden /> Clients
        </Link>
        <PageHeader
          title="Monthly statements"
          sub="What each client is billed per calendar month (UTC). Closing a month freezes its numbers."
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <MonthSwitcher period={period} current={current} href={(p) => `/statements?month=${p}`} />
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <a href={`/statements/export?month=${period}`} className="btn btn-quiet" download>
            <Download size={16} aria-hidden /> Month CSV
          </a>
          {closable && drafts > 0 ? (
            <form action={closeAllDraftsAction}>
              <input type="hidden" name="period" value={period} />
              <button className="btn btn-primary w-full">
                <Lock size={16} aria-hidden /> Close {drafts === 1 ? "1 draft" : `all ${drafts} drafts`}
              </button>
            </form>
          ) : (
            <span className="inline-flex min-h-11 items-center justify-center text-center text-[13px] text-ink-3 sm:px-2">
              {!closable ? "Month still running" : "All closed"}
            </span>
          )}
        </div>
      </div>

      <section aria-label="Month totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Billed to clients" value={usd(billed)} sub={fees > 0 ? `incl. ${usd(fees)} fixed fees` : undefined} />
        <Tile label="Provider cost" value={usd(cost)} />
        <Tile label="Margin" value={usd(billed - cost)} loss={billed - cost < 0} />
        <Tile label="Closed" value={`${list.length - drafts} of ${list.length}`} sub={drafts ? `${drafts} draft${drafts === 1 ? "" : "s"}` : "Month closed"} />
      </section>

      {list.length === 0 ? (
        <EmptyState title="No clients yet" />
      ) : (
        <>
          <ul className="space-y-3 lg:hidden">
            {list.map((s) => (
              <li key={s.client.id} className="rounded-xl border border-line bg-surface">
                <Link href={`/clients/${s.client.id}/statements/${period}`} className="block p-4 active:bg-surface-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.client.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <StatusBadge status={s.status} />
                        <BillingBadge mode={s.data.terms.billingMode} />
                        {s.data.totals.marginUsd < 0 && <LossTag />}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      <div className="text-right">
                        <p className="num text-[17px] font-semibold">{usd(s.data.totals.totalBilledUsd)}</p>
                        <p className="text-[12px] text-ink-3">billed</p>
                      </div>
                      <ChevronRight size={18} className="mt-1 text-ink-3" aria-hidden />
                    </div>
                  </div>
                  <dl className="num mt-3 grid grid-cols-3 gap-2 text-[13px]">
                    <div>
                      <dt className="text-ink-3">Cost</dt>
                      <dd>{usd(s.data.totals.costUsd)}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Fixed fee</dt>
                      <dd>{s.data.terms.billingMode === "fixed" ? usd(s.data.totals.fixedFeeUsd) : "–"}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Margin</dt>
                      <dd>
                        <MarginValue value={s.data.totals.marginUsd} />
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface lg:block">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Billing</th>
                  <th>Status</th>
                  <th className="r">Provider cost</th>
                  <th className="r">Billed for usage</th>
                  <th className="r">Fixed fee</th>
                  <th className="r">Total billed</th>
                  <th className="r">Margin</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => {
                  const t = s.data.totals;
                  return (
                    <tr key={s.client.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Link href={`/clients/${s.client.id}/statements/${period}`} className="font-medium hover:underline">
                            {s.client.name}
                          </Link>
                          {t.marginUsd < 0 && <LossTag />}
                        </div>
                      </td>
                      <td>
                        <BillingBadge mode={s.data.terms.billingMode} markupPct={s.data.terms.markupPct} fixedFeeUsd={s.data.terms.fixedFeeUsd} />
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="r">{usd(t.costUsd)}</td>
                      <td className="r">{usd(t.usageBilledUsd)}</td>
                      <td className="r">{s.data.terms.billingMode === "fixed" ? usd(t.fixedFeeUsd) : "–"}</td>
                      <td className="r font-medium">{usd(t.totalBilledUsd)}</td>
                      <td className="r">
                        <MarginValue value={t.marginUsd} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-medium">
                  <td className="px-3 py-2.5" colSpan={3}>
                    Total
                  </td>
                  <td className="r px-3">{usd(cost)}</td>
                  <td className="r px-3">{usd(sum((s) => s.data.totals.usageBilledUsd))}</td>
                  <td className="r px-3">{usd(fees)}</td>
                  <td className="r px-3">{usd(billed)}</td>
                  <td className="r px-3">
                    <MarginValue value={billed - cost} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <p className="text-[13px] text-ink-3">
        Drafts are computed live. The running month bills fixed fees prorated to date; a month can be closed once it has ended.
      </p>
    </div>
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
