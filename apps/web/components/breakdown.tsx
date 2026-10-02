import type { BreakdownRow } from "@/lib/queries.ts";
import { compactNum, count, usd } from "@/lib/format.ts";
import { EmptyState } from "./ui.tsx";

/**
 * One dimension of a client's usage. Desktop shows the full table; phones show each row
 * as a label, its cost, and a share-of-cost bar. Bar colour: the row's slot if given, else slot 1.
 */
export function Breakdown({ rows, slots, labelHeader }: { rows: BreakdownRow[]; slots?: Map<string, number>; labelHeader: string }) {
  if (rows.length === 0) return <EmptyState title="No usage in this range" />;
  const total = rows.reduce((a, r) => a + r.cost, 0) || 1;
  const max = Math.max(...rows.map((r) => r.cost)) || 1;
  const color = (key: string) => `var(--s${slots?.get(key) ?? 1})`;

  return (
    <>
      <ul className="space-y-3 lg:hidden">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">
                <span className="font-medium">{r.label}</span>
                {r.sub && <span className="ml-1.5 text-[12px] text-ink-3">{r.sub}</span>}
              </span>
              <span className="num shrink-0 font-medium">{usd(r.cost)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${(r.cost / max) * 100}%`, background: color(r.key) }} />
            </div>
            <p className="num mt-1 text-[12px] text-ink-3">
              {((r.cost / total) * 100).toFixed(0)}% of cost, {count(r.requests)} requests, billed {usd(r.billed)}
            </p>
          </li>
        ))}
      </ul>
      <div className="-mx-5 hidden overflow-x-auto lg:block">
        <table className="dtable">
          <thead>
            <tr>
              <th className="pl-5">{labelHeader}</th>
              <th className="r">Requests</th>
              <th className="r">Input</th>
              <th className="r">Output</th>
              <th className="r">Cached</th>
              <th className="r">Cost</th>
              <th className="r">Billed</th>
              <th className="w-[18%] pr-5">Share of cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="pl-5 whitespace-nowrap">
                  <span className="font-medium">{r.label}</span>
                  {r.sub && <span className="ml-1.5 text-[12px] text-ink-3">{r.sub}</span>}
                </td>
                <td className="r">{count(r.requests)}</td>
                <td className="r">{compactNum(r.inputTokens)}</td>
                <td className="r">{compactNum(r.outputTokens)}</td>
                <td className="r">{compactNum(r.cacheTokens)}</td>
                <td className="r font-medium">{usd(r.cost)}</td>
                <td className="r">{usd(r.billed)}</td>
                <td className="pr-5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                      <div className="h-full rounded-full" style={{ width: `${(r.cost / max) * 100}%`, background: color(r.key) }} />
                    </div>
                    <span className="num w-9 text-right text-[12px] text-ink-3">{((r.cost / total) * 100).toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
