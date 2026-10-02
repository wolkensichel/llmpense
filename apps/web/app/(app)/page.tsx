import Link from "next/link";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientMargins, dailyCostByClient, listAlerts, type ClientRow } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { compactNum, count, delta, pct, usd } from "@/lib/format.ts";
import { DailyChart, type Series } from "@/components/daily-chart.tsx";
import { AlertList } from "@/components/alert-list.tsx";
import {
  BillingBadge,
  ClientDot,
  Delta,
  EmptyState,
  FrozenNote,
  LossTag,
  MarginBar,
  MarginBarLegend,
  MarginPct,
  MarginValue,
  Panel,
} from "@/components/ui.tsx";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function OverviewPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await getCurrentOrg();
  const [m, daily, alerts] = await Promise.all([
    clientMargins(org.id, range),
    dailyCostByClient(org.id, range),
    listAlerts(org.id, { unacknowledgedOnly: true, limit: 5 }),
  ]);
  const cur = m.total.current;
  const prev = m.total.previous;
  const q = range.key === "30d" ? "" : `?range=${range.key}`;

  // Chart series follow each client's fixed colour slot; clients past the 8th and
  // unattributed traffic fold into one grey "Other" series.
  const series: Series[] = m.clients.filter((r) => r.client!.slot > 0).map((r) => ({ key: r.client!.id, name: r.client!.name, slot: r.client!.slot }));
  const keyed = new Set(series.map((s) => s.key));
  const data = daily.map((row) => {
    const out: Record<string, number | string> = { day: row.day };
    let other = 0;
    for (const [k, v] of Object.entries(row)) {
      if (k === "day") continue;
      if (keyed.has(k)) out[k] = Number(v);
      else other += Number(v);
    }
    if (other > 0) out.other = other;
    return out as { day: string } & Record<string, number>;
  });
  if (data.some((r) => (r.other ?? 0) > 0)) series.push({ key: "other", name: "Other", slot: 0 });

  const ranked: ClientRow[] = [...m.clients, ...(m.unattributed ? [m.unattributed] : [])]
    .filter((r) => r.current.costUsd > 0 || r.current.revenueUsd > 0)
    .sort((a, b) => b.current.costUsd - a.current.costUsd);
  const scale = Math.max(1, ...ranked.map((r) => Math.max(r.current.costUsd, r.current.revenueUsd)));
  const losing = ranked.filter((r) => r.current.marginUsd < 0);

  return (
    <div className="space-y-5 lg:space-y-6">
      <section aria-labelledby="hero" className="pt-1">
        <p className="text-sm text-ink-2">{range.label}, all clients</p>
        <h1 id="hero" className="mt-1 text-[40px] leading-[1.05] font-semibold tracking-[-0.02em] sm:text-[52px]">
          You spent {usd(cur.costUsd)} on AI
        </h1>
        <p className="mt-2 max-w-[60ch] text-[16px] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">{compactNum(cur.tokens)}</span> tokens across{" "}
          <span className="font-medium text-ink">{count(cur.requests)}</span> requests. Clients were billed{" "}
          <span className="font-medium text-ink">{usd(cur.revenueUsd)}</span> for it
          {cur.marginPct !== null ? (
            <>
              , {cur.marginUsd >= 0 ? "leaving you " : "a loss of "}
              <span className={`font-medium ${cur.marginUsd >= 0 ? "text-ink" : "text-loss-ink"}`}>{usd(Math.abs(cur.marginUsd))}</span> (
              {pct(cur.marginPct)} margin).
            </>
          ) : (
            "."
          )}{" "}
          {losing.length > 0 && (
            <>
              {losing.length === 1 ? "One client costs" : `${losing.length} clients cost`} more than they pay.
            </>
          )}
        </p>
        <div className="mt-2 flex items-center gap-2 text-[13px] text-ink-3">
          <Delta value={delta(cur.costUsd, prev.costUsd)} good="neutral" />
          <span>spend vs the previous {range.key === "lm" ? "month" : "period"}</span>
        </div>
      </section>

      <section aria-label="Key figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Spent at providers" value={usd(cur.costUsd)} delta={<Delta value={delta(cur.costUsd, prev.costUsd)} good="neutral" />} />
        <Tile
          label="Tokens"
          value={compactNum(cur.tokens)}
          sub={`${count(cur.requests)} requests`}
          delta={<Delta value={delta(cur.tokens, prev.tokens)} good="neutral" />}
        />
        <Tile
          label="Billed to clients"
          value={usd(cur.revenueUsd)}
          sub={cur.fixedFeeUsd > 0 ? `incl. ${usd(cur.fixedFeeUsd)} fixed fees` : undefined}
          delta={<Delta value={delta(cur.revenueUsd, prev.revenueUsd)} />}
        />
        <Tile
          label="Margin"
          value={pct(cur.marginPct)}
          valueClass={cur.marginPct !== null && cur.marginPct < 0 ? "text-loss-ink" : ""}
          sub={usd(cur.marginUsd)}
          delta={
            <Delta
              value={cur.marginPct !== null && prev.marginPct !== null ? cur.marginPct - prev.marginPct : null}
              kind="points"
            />
          }
        />
      </section>

      <Panel title="Daily provider cost" sub="Stacked by client, UTC days">
        {cur.requests === 0 ? (
          <EmptyState title="No usage in this range">Send traffic through the proxy or the ingest API to see it here.</EmptyState>
        ) : (
          <DailyChart data={data} series={series} caption={`Daily provider cost by client, ${range.label}`} />
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
        <Panel
          title="Clients by spend"
          sub="What each client's AI cost you, against what they paid"
          actions={
            <Link href={`/clients${q}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
              All clients
            </Link>
          }
        >
          {ranked.length === 0 ? (
            <EmptyState title="No client usage yet" />
          ) : (
            <>
              <MarginBarLegend />
              <ul className="mt-3 divide-y divide-line">
                {ranked.map((r) => (
                  <RankedClient key={r.client?.id ?? "none"} row={r} scale={scale} q={q} />
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel
          title="Open alerts"
          sub="Budget thresholds crossed"
          actions={
            <Link href="/budgets" className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
              Budgets
            </Link>
          }
        >
          {alerts.length === 0 ? <EmptyState title="Nothing needs attention" /> : <AlertList items={alerts} />}
        </Panel>
      </div>

      <FrozenNote />
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  delta,
  valueClass = "",
}: {
  label: string;
  value: string;
  sub?: string;
  delta: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5 lg:p-4">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className={`mt-1 text-[22px] leading-7 font-semibold tracking-tight lg:text-[26px] lg:leading-8 ${valueClass}`}>{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2">
        {delta}
        {sub && <span className="text-[12px] text-ink-3">{sub}</span>}
      </div>
    </div>
  );
}

function RankedClient({ row, scale, q }: { row: ClientRow; scale: number; q: string }) {
  const c = row.client;
  const cur = row.current;
  const name = (
    <span className="flex min-w-0 items-center gap-2">
      <ClientDot slot={c?.slot ?? 0} />
      <span className="truncate font-medium">{c?.name ?? "Unattributed"}</span>
    </span>
  );
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {c ? (
            <Link href={`/clients/${c.id}${q}`} className="-my-1.5 flex min-h-11 min-w-0 items-center hover:underline">
              {name}
            </Link>
          ) : (
            name
          )}
          {c && <BillingBadge mode={c.billingMode} />}
          {cur.marginUsd < 0 && <LossTag />}
        </div>
        <div className="shrink-0 text-right">
          <MarginValue value={cur.marginUsd} className="font-semibold" />
          <MarginPct value={cur.marginPct} className="ml-2 text-[13px]" />
        </div>
      </div>
      <div className="mt-2">
        <MarginBar cost={cur.costUsd} revenue={cur.revenueUsd} scale={scale} />
      </div>
      <p className="num mt-1 text-[12px] text-ink-3">
        Cost {usd(cur.costUsd)}, revenue {usd(cur.revenueUsd)}
      </p>
    </li>
  );
}
