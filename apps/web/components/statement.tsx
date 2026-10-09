import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { shiftPeriod, type StatementData, type StatementStatus } from "@llmpense/core";
import { compactNum, count, monthLabel, usd } from "@/lib/format.ts";
import { EmptyState } from "./ui.tsx";

export function StatusBadge({ status }: { status: StatementStatus }) {
  return status === "closed" ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 text-xs leading-5 font-medium whitespace-nowrap text-accent">
      <Lock size={11} strokeWidth={2.25} aria-hidden />
      Closed
    </span>
  ) : (
    <span className="inline-flex items-center rounded-md border border-dashed border-line-strong px-1.5 text-xs leading-5 whitespace-nowrap text-ink-2">
      Draft
    </span>
  );
}

/** Previous / next month links around the current month label. */
export function MonthSwitcher({ period, current, href }: { period: string; current: string; href: (p: string) => string }) {
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const btn = "inline-flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink";
  return (
    <nav aria-label="Month" className="flex items-center rounded-lg border border-line bg-surface">
      <Link href={href(prev)} className={btn} aria-label={`Previous month, ${monthLabel(prev)}`}>
        <ChevronLeft size={18} aria-hidden />
      </Link>
      <span className="num min-w-[9.5rem] flex-1 text-center text-sm font-medium">{monthLabel(period)}</span>
      {next <= current ? (
        <Link href={href(next)} className={btn} aria-label={`Next month, ${monthLabel(next)}`}>
          <ChevronRight size={18} aria-hidden />
        </Link>
      ) : (
        <span className={`${btn} opacity-30`} aria-hidden>
          <ChevronRight size={18} />
        </span>
      )}
    </nav>
  );
}

const lineTokens = (l: StatementData["lines"][number]) => l.inputTokens + l.outputTokens + l.cacheReadTokens + l.cacheWriteTokens;

/** Internal line items: provider cost next to the billed amount. Cards on phones, a table on desktop. */
export function StatementLines({ data }: { data: StatementData }) {
  if (data.lines.length === 0) return <EmptyState title="No usage this month" />;
  const t = data.totals;
  return (
    <>
      <ul className="divide-y divide-line lg:hidden">
        {data.lines.map((l, i) => (
          <li key={i} className="py-3 first:pt-0">
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0">
                <span className="block truncate font-medium">{l.project}</span>
                {l.kind === "usage" && (
                  <span className="block truncate text-[13px] text-ink-2">
                    {l.model} <span className="text-ink-3">{l.provider}</span>
                  </span>
                )}
              </span>
              <span className="num shrink-0 font-medium">{usd(l.billedUsd)}</span>
            </div>
            {l.kind === "usage" && (
              <p className="num mt-1 text-[12px] text-ink-3">
                {count(l.requests)} requests, {compactNum(lineTokens(l))} tokens, cost {usd(l.costUsd)}
              </p>
            )}
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 pt-3 font-semibold">
          <span>Total billed</span>
          <span className="num">{usd(t.totalBilledUsd)}</span>
        </li>
      </ul>
      <div className="-mx-5 hidden lg:block">
        <table className="dtable">
          <thead>
            <tr>
              <th className="pl-5">Project</th>
              <th>Model</th>
              <th className="r">Requests</th>
              <th className="r">Tokens</th>
              <th className="r">Provider cost</th>
              <th className="r pr-5">Billed</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l, i) => (
              <tr key={i}>
                <td className="pl-5 font-medium">{l.project}</td>
                <td>
                  {l.kind === "usage" ? (
                    <>
                      {l.model} <span className="text-[12px] text-ink-3">{l.provider}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">–</span>
                  )}
                </td>
                <td className="r">{l.kind === "usage" ? count(l.requests) : ""}</td>
                <td className="r">{l.kind === "usage" ? compactNum(lineTokens(l)) : ""}</td>
                <td className="r">{l.kind === "usage" ? usd(l.costUsd) : ""}</td>
                <td className="r pr-5 font-medium">{usd(l.billedUsd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong font-semibold">
              <td className="py-2.5 pl-5" colSpan={2}>
                Total
              </td>
              <td className="r px-3">{count(t.requests)}</td>
              <td className="r px-3">{compactNum(t.tokens)}</td>
              <td className="r px-3">{usd(t.costUsd)}</td>
              <td className="r px-3 pr-5">{usd(t.totalBilledUsd)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
