import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientMargins, type ClientRow } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { count, usd } from "@/lib/format.ts";
import { BillingBadge, ClientDot, EmptyState, FrozenNote, LossTag, MarginBar, MarginPct, MarginValue, PageHeader } from "@/components/ui.tsx";

export const metadata: Metadata = { title: "Clients" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ClientsPage({ searchParams }: { searchParams: SP }) {
  const range = resolveRange((await searchParams).range);
  const org = await getCurrentOrg();
  const m = await clientMargins(org.id, range);
  const rows = [...m.clients].sort((a, b) => b.current.marginUsd - a.current.marginUsd);
  const all = m.unattributed && m.unattributed.current.requests > 0 ? [...rows, m.unattributed] : rows;
  const scale = Math.max(1, ...all.map((r) => Math.max(r.current.costUsd, r.current.revenueUsd)));
  const q = range.key === "30d" ? "" : `?range=${range.key}`;
  const t = m.total.current;

  return (
    <div className="space-y-5">
      <PageHeader title="Clients" sub={`${range.label}. Sorted by margin.`} />

      {all.length === 0 ? (
        <EmptyState title="No clients yet">
          Clients appear automatically the first time a request carries an <code>x-llmpense-client</code> header.
        </EmptyState>
      ) : (
        <>
          {/* Phone: cards */}
          <ul className="space-y-3 lg:hidden">
            {all.map((r) => (
              <ClientCard key={r.client?.id ?? "none"} row={r} scale={scale} q={q} />
            ))}
          </ul>

          {/* Desktop: dense table */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface lg:block">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Billing</th>
                  <th className="r">Requests</th>
                  <th className="r">Provider cost</th>
                  <th className="r">Revenue</th>
                  <th className="r">Margin</th>
                  <th className="r">Margin %</th>
                  <th className="w-[22%]">
                    <span className="sr-only">Cost against revenue</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {all.map((r) => {
                  const c = r.client;
                  const cur = r.current;
                  return (
                    <tr key={c?.id ?? "none"} className={cur.marginUsd < 0 ? "[&>td:first-child]:shadow-[inset_3px_0_0_var(--loss)]" : ""}>
                      <td>
                        <div className="flex items-center gap-2">
                          <ClientDot slot={c?.slot ?? 0} />
                          {c ? (
                            <Link href={`/clients/${c.id}${q}`} className="font-medium hover:underline">
                              {c.name}
                            </Link>
                          ) : (
                            <span className="font-medium">Unattributed</span>
                          )}
                          {cur.marginUsd < 0 && <LossTag />}
                        </div>
                      </td>
                      <td>{c ? <BillingBadge mode={c.billingMode} markupPct={c.markupPct} fixedFeeUsd={c.fixedFeeUsd} /> : <span className="text-ink-3">None</span>}</td>
                      <td className="r">{count(cur.requests)}</td>
                      <td className="r">{usd(cur.costUsd)}</td>
                      <td className="r">
                        {usd(cur.revenueUsd)}
                        {cur.fixedFeeUsd > 0 && <span className="block text-[12px] text-ink-3">fee {usd(cur.fixedFeeUsd)}</span>}
                      </td>
                      <td className="r font-medium">
                        <MarginValue value={cur.marginUsd} />
                      </td>
                      <td className="r">
                        <MarginPct value={cur.marginPct} />
                      </td>
                      <td>
                        <MarginBar cost={cur.costUsd} revenue={cur.revenueUsd} scale={scale} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong font-medium">
                  <td className="px-3 py-2.5" colSpan={2}>
                    Total
                  </td>
                  <td className="r px-3">{count(t.requests)}</td>
                  <td className="r px-3">{usd(t.costUsd)}</td>
                  <td className="r px-3">{usd(t.revenueUsd)}</td>
                  <td className="r px-3">
                    <MarginValue value={t.marginUsd} />
                  </td>
                  <td className="r px-3">
                    <MarginPct value={t.marginPct} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      <FrozenNote />
    </div>
  );
}

function ClientCard({ row, scale, q }: { row: ClientRow; scale: number; q: string }) {
  const c = row.client;
  const cur = row.current;
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <ClientDot slot={c?.slot ?? 0} />
            <span className="truncate font-medium">{c?.name ?? "Unattributed"}</span>
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {c && <BillingBadge mode={c.billingMode} markupPct={c.markupPct} fixedFeeUsd={c.fixedFeeUsd} />}
            {cur.marginUsd < 0 && <LossTag />}
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <div className="text-right">
            <MarginValue value={cur.marginUsd} className="block text-[17px] font-semibold" />
            <MarginPct value={cur.marginPct} className="text-[13px]" />
          </div>
          {c && <ChevronRight size={18} className="mt-1 text-ink-3" aria-hidden />}
        </div>
      </div>
      <div className="mt-3">
        <MarginBar cost={cur.costUsd} revenue={cur.revenueUsd} scale={scale} />
      </div>
      <dl className="num mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div>
          <dt className="text-ink-3">Cost</dt>
          <dd>{usd(cur.costUsd)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Revenue</dt>
          <dd>{usd(cur.revenueUsd)}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Requests</dt>
          <dd>{count(cur.requests)}</dd>
        </div>
      </dl>
    </>
  );
  return (
    <li className={`rounded-xl border bg-surface ${cur.marginUsd < 0 ? "border-loss/40" : "border-line"}`}>
      {c ? (
        <Link href={`/clients/${c.id}${q}`} className="block p-4 active:bg-surface-2">
          {body}
        </Link>
      ) : (
        <div className="p-4">{body}</div>
      )}
    </li>
  );
}
