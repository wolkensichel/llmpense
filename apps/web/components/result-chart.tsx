"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ResultDay {
  day: string;
  runs: number;
  successes: number;
  costUsd: number;
  /** Null on days without successes: no bar is drawn. */
  costPerSuccess: number | null;
}

const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd3 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 });
const usdSig = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumSignificantDigits: 2, maximumSignificantDigits: 3 });
const unit = (n: number) => (n >= 1 ? usd2 : n >= 0.1 || n === 0 ? usd3 : usdSig).format(n);
const int = new Intl.NumberFormat("en-US");

function TooltipBody({ active, row }: { active?: boolean; row?: ResultDay }) {
  if (!active || !row) return null;
  return (
    <div className="min-w-48 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">
      <p className="mb-1 font-medium">{dayLabel(row.day)}</p>
      <p className="flex justify-between gap-4">
        <span className="text-ink-2">Cost per success</span>
        <span className="num font-medium">{row.costPerSuccess === null ? "–" : unit(row.costPerSuccess)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-ink-2">Runs, successes</span>
        <span className="num">
          {int.format(row.runs)}, {int.format(row.successes)}
        </span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-ink-2">Cost of the runs</span>
        <span className="num">{usd2.format(row.costUsd)}</span>
      </p>
    </div>
  );
}

/** Daily cost per success (by outcome date). Days without successes have no bar. */
export function ResultChart({ data, caption, height = 220 }: { data: ResultDay[]; caption: string; height?: number }) {
  const gap = data.length <= 35;
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={gap ? "22%" : "12%"}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="day"
              tickFormatter={dayLabel}
              tick={{ fill: "var(--ink-3)", fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line-strong)" }}
              minTickGap={28}
              interval="preserveStartEnd"
            />
            <YAxis tickFormatter={unit} tick={{ fill: "var(--ink-3)", fontSize: 12 }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p) => <TooltipBody active={p.active} row={(p.payload?.[0] as { payload?: ResultDay } | undefined)?.payload} />}
            />
            <Bar dataKey="costPerSuccess" name="Cost per success" fill="var(--s1)" maxBarSize={24} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-[13px]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-ink-2 hover:text-ink">Show as table</summary>
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="dtable">
            <thead>
              <tr>
                <th>Day</th>
                <th className="r">Runs</th>
                <th className="r">Successes</th>
                <th className="r">Cost</th>
                <th className="r">Cost per success</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.day}>
                  <td className="whitespace-nowrap">{dayLabel(r.day)}</td>
                  <td className="r">{int.format(r.runs)}</td>
                  <td className="r">{int.format(r.successes)}</td>
                  <td className="r">{usd2.format(r.costUsd)}</td>
                  <td className="r">{r.costPerSuccess === null ? "–" : unit(r.costPerSuccess)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
