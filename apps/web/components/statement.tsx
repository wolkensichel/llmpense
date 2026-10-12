import Link from "next/link";
import { ChevronLeft, ChevronRight, Lock, TriangleAlert } from "lucide-react";
import { ECB_ACKNOWLEDGEMENT, rateNote, shiftPeriod, type FxRate, type StatementData, type StatementStatus } from "@llmpense/core";
import { compactNum, count, money, monthLabel, usd } from "@/lib/format.ts";
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

/** A small currency code tag for clients billed in something other than USD. */
export function CurrencyTag({ currency }: { currency: string }) {
  if (currency === "USD") return null;
  return (
    <span className="inline-flex items-center rounded-md border border-line px-1.5 font-mono text-[11px] leading-5 whitespace-nowrap text-ink-2">
      {currency}
    </span>
  );
}

/** Billed amount in the statement's currency, or a dash when there is no rate. */
export function billedText(amount: number | null, data: StatementData): string {
  return amount === null ? "–" : money(amount, data.terms.currency);
}

/** "1 USD = 0.9213 EUR, ECB reference rate of 30 Sep 2026" plus the source line for ECB rates. */
export function RateLine({ fx, className = "" }: { fx: FxRate | null; className?: string }) {
  const note = rateNote(fx);
  if (!note) return null;
  return (
    <p className={`text-[13px] text-ink-3 ${className}`}>
      {note}.{fx?.source === "ecb" && <> {ECB_ACKNOWLEDGEMENT}</>}
    </p>
  );
}

/** Warning for a statement in a currency that has no exchange rate for its month. */
export function MissingRate({ data }: { data: StatementData }) {
  if (data.fx) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg border border-line bg-loss-soft px-3 py-2.5 text-[13px] text-loss-ink">
      <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        No {data.terms.currency} exchange rate for {monthLabel(data.period)} yet, so amounts in {data.terms.currency} can't be shown and the
        statement can't be closed. Run <code>pnpm fx:sync</code> or add a manual rate under Settings &gt; Exchange rates.
      </span>
    </p>
  );
}

const lineTokens = (l: StatementData["lines"][number]) => l.inputTokens + l.outputTokens + l.cacheReadTokens + l.cacheWriteTokens;

/**
 * Internal line items: provider cost (USD) next to the billed amount in the billing currency and,
 * for other currencies, its USD equivalent. Cards on phones, a table on desktop. Always names models.
 */
export function StatementLines({ data }: { data: StatementData }) {
  if (data.lines.length === 0) return <EmptyState title="No usage this month" />;
  const t = data.totals;
  const foreign = data.terms.currency !== "USD";
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
              <span className="num shrink-0 text-right font-medium">
                {billedText(l.billed, data)}
                {foreign && <span className="block text-[12px] font-normal text-ink-3">{usd(l.billedUsd)}</span>}
              </span>
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
          <span className="num text-right">
            {billedText(t.totalBilled, data)}
            {foreign && <span className="block text-[12px] font-normal text-ink-3">{usd(t.totalBilledUsd)}</span>}
          </span>
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
              <th className={`r ${foreign ? "" : "pr-5"}`}>Billed{foreign ? ` (${data.terms.currency})` : ""}</th>
              {foreign && <th className="r pr-5">Billed (USD)</th>}
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
                <td className={`r font-medium ${foreign ? "" : "pr-5"}`}>{billedText(l.billed, data)}</td>
                {foreign && <td className="r pr-5 text-ink-2">{usd(l.billedUsd)}</td>}
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
              <td className={`r px-3 ${foreign ? "" : "pr-5"}`}>{billedText(t.totalBilled, data)}</td>
              {foreign && <td className="r px-3 pr-5">{usd(t.totalBilledUsd)}</td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
