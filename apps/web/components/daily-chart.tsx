"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Series {
  key: string;
  name: string;
  /** Categorical slot 1-8; 0 = "other" grey. */
  slot: number;
}

type Row = { day: string } & Record<string, number | string>;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyTick = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Math.round(v)}`);
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function TooltipBody({
  active,
  payload,
  label,
  series,
  line,
}: {
  active?: boolean;
  payload?: { dataKey?: string | number; value?: number }[];
  label?: string;
  series: Series[];
  line?: { key: string; name: string };
}) {
  if (!active || !payload?.length || !label) return null;
  const byKey = new Map(payload.map((p) => [String(p.dataKey), Number(p.value ?? 0)]));
  const rows = series.map((s) => ({ ...s, v: byKey.get(s.key) ?? 0 })).filter((r) => r.v > 0);
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <div className="min-w-48 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">
      <p className="mb-1 font-medium">{dayLabel(label)}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: `var(--s${r.slot})` }} />
            <span className="flex-1 text-ink-2">{r.name}</span>
            <span className="num">{money.format(r.v)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 flex justify-between border-t border-line pt-1">
        <span className="text-ink-2">Provider cost</span>
        <span className="num font-medium">{money.format(total)}</span>
      </p>
      {line && (
        <p className="flex justify-between">
          <span className="text-ink-2">{line.name}</span>
          <span className="num font-medium">{money.format(byKey.get(line.key) ?? 0)}</span>
        </p>
      )}
    </div>
  );
}

export function DailyChart({
  data,
  series,
  line,
  height = 240,
  caption,
}: {
  data: Row[];
  series: Series[];
  line?: { key: string; name: string };
  height?: number;
  caption: string;
}) {
  const gap = data.length <= 35;
  return (
    <figure>
      <figcaption className="sr-only">{caption}</figcaption>
      {(series.length > 1 || line) && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2" aria-label="Legend">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: `var(--s${s.slot})` }} />
              {s.name}
            </li>
          ))}
          {line && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className="relative inline-block h-0.5 w-4 rounded bg-ink">
                <span className="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink" />
              </span>
              {line.name}
            </li>
          )}
        </ul>
      )}
      <div style={{ height }} className="-ml-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={gap ? "22%" : "12%"}>
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
            <YAxis
              tickFormatter={moneyTick}
              tick={{ fill: "var(--ink-3)", fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={48}
              allowDecimals={false}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={(p) => (
                <TooltipBody
                  active={p.active}
                  payload={p.payload as unknown as { dataKey?: string; value?: number }[]}
                  label={p.label as string}
                  series={series}
                  line={line}
                />
              )}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="cost"
                fill={`var(--s${s.slot})`}
                stroke={gap ? "var(--surface)" : "none"}
                strokeWidth={gap ? 1 : 0}
                maxBarSize={24}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
              />
            ))}
            {line && (
              <Line
                dataKey={line.key}
                name={line.name}
                // One value per day: straight segments with a dot over each bar, not a smoothed trend.
                type="linear"
                stroke="var(--ink)"
                strokeWidth={1.5}
                dot={{ r: 2.5, stroke: "var(--ink)", strokeWidth: 0, fill: "var(--ink)" }}
                activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2, fill: "var(--ink)" }}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-[13px]">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-ink-2 hover:text-ink">Show as table</summary>
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="dtable">
            <thead>
              <tr>
                <th>Day</th>
                {series.map((s) => (
                  <th key={s.key} className="r">
                    {s.name}
                  </th>
                ))}
                {line && <th className="r">{line.name}</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.day}>
                  <td className="whitespace-nowrap">{dayLabel(r.day)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="r">
                      {money.format(Number(r[s.key] ?? 0))}
                    </td>
                  ))}
                  {line && <td className="r">{money.format(Number(r[line.key] ?? 0))}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
