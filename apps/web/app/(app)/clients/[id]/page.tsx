import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { clientStatementStatuses } from "@llmpense/db";
import { getDb } from "@/lib/db.ts";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientBreakdown, clientDaily, clientMargins, clientMonths, getClient, listProjects } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { compactNum, count, delta, longDate, money, monthLabel, pct, usd } from "@/lib/format.ts";
import { CurrencyTag, StatusBadge } from "@/components/statement.tsx";
import { isOverdue, type Currency } from "@llmpense/core";
import { DailyChart, type Series } from "@/components/daily-chart.tsx";
import { Breakdown } from "@/components/breakdown.tsx";
import { BillingBadge, ClientDot, Delta, FrozenNote, LossTag, MarginBar, MarginBarLegend, Panel } from "@/components/ui.tsx";
import { BillingForm } from "./billing-form.tsx";
import { PendingNote, ResultTable } from "@/components/results.tsx";
import { resultsOverview } from "@/lib/results.ts";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const org = await getCurrentOrg();
  const c = await getClient(org.id, (await params).id);
  return { title: c?.name ?? "Client" };
}

export default async function ClientPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const range = resolveRange(sp.range);
  const org = await getCurrentOrg();
  const client = await getClient(org.id, id);
  if (!client) notFound();

  const [margins, daily, byProject, byModel, byFeature, projects, months, statuses, results] = await Promise.all([
    clientMargins(org.id, range),
    clientDaily(org.id, client, range),
    clientBreakdown(org.id, client.id, range, "project"),
    clientBreakdown(org.id, client.id, range, "model"),
    clientBreakdown(org.id, client.id, range, "feature"),
    listProjects(org.id),
    clientMonths(org.id, client.id),
    clientStatementStatuses(getDb(), org.id, client.id),
    resultsOverview({ orgId: org.id, range, clientId: id }),
  ]);
  const row = margins.clients.find((r) => r.client?.id === client.id)!;
  const cur = row.current;
  const prev = row.previous;
  const q = range.key === "30d" ? "" : `?range=${range.key}`;

  // Project colours: stable order of this client's projects.
  const own = projects.filter((p) => p.clientId === client.id);
  const projectSlots = new Map(own.map((p, i) => [p.id, i < 8 ? i + 1 : 0]));
  const series: Series[] = own.map((p) => ({ key: p.id, name: p.name, slot: projectSlots.get(p.id)! }));
  if (daily.some((d) => (d as Record<string, unknown>).none)) series.push({ key: "none", name: "No project", slot: 0 });
  projectSlots.set("-", 0);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const thisMonth = now.toISOString().slice(0, 7);
  const monthOptions = months.length ? months : [thisMonth];
  const statementMonths = [...new Set([thisMonth, ...months])].sort().reverse().slice(0, 6);

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <Link href={`/clients${q}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft size={16} aria-hidden /> Clients
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ClientDot slot={client.slot} className="size-3" />
          <h1 className="text-[26px] leading-8 font-semibold tracking-tight lg:text-[30px] lg:leading-9">{client.name}</h1>
          <BillingBadge mode={client.billingMode} markupPct={client.markupPct} fixedFee={client.fixedFee} currency={client.billingCurrency} />
          <CurrencyTag currency={client.billingCurrency} />
          {cur.marginUsd < 0 && <LossTag />}
        </div>
        <p className="mt-1 text-sm text-ink-2">{range.label}</p>
      </div>

      <section aria-label="Key figures" className="rounded-xl border border-line bg-surface p-4 lg:p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <Fig label="Spent at providers" value={usd(cur.costUsd)} d={<Delta value={delta(cur.costUsd, prev.costUsd)} good="neutral" />} />
          <Fig label="Tokens" value={compactNum(cur.tokens)} d={<Delta value={delta(cur.tokens, prev.tokens)} good="neutral" />} />
          <Fig label="Requests" value={count(cur.requests)} d={<Delta value={delta(cur.requests, prev.requests)} good="neutral" />} />
          <Fig
            label="Billed to client"
            value={usd(cur.revenueUsd)}
            d={
              cur.fixedFeeUsd > 0 ? (
                <span className="text-[13px] text-ink-3">prorated fee</span>
              ) : (
                <Delta value={delta(cur.revenueUsd, prev.revenueUsd)} />
              )
            }
          />
          <Fig label="Margin" value={usd(cur.marginUsd)} loss={cur.marginUsd < 0} d={<Delta value={delta(cur.marginUsd, prev.marginUsd)} />} />
          <Fig
            label="Margin %"
            value={pct(cur.marginPct)}
            loss={cur.marginPct !== null && cur.marginPct < 0}
            d={<Delta value={cur.marginPct !== null && prev.marginPct !== null ? cur.marginPct - prev.marginPct : null} kind="points" />}
          />
        </dl>
        <div className="mt-4 border-t border-line pt-4">
          <MarginBar cost={cur.costUsd} revenue={cur.revenueUsd} scale={Math.max(cur.costUsd, cur.revenueUsd)} />
          <div className="mt-2">
            <MarginBarLegend />
          </div>
        </div>
      </section>

      <Panel title="Daily spend and billing" sub={billingLineNote(client)}>
        <DailyChart
          data={daily as never}
          series={series}
          line={client.billingMode === "absorbed" ? undefined : { key: "revenue", name: "Billed to client" }}
          caption={`Daily spend by project and amount billed to ${client.name}`}
        />
      </Panel>

      <Panel title="Projects" flush={false}>
        <Breakdown rows={byProject} slots={projectSlots} labelHeader="Project" />
      </Panel>

      <div className="grid gap-5 lg:gap-6">
        <Panel title="Models">
          <Breakdown rows={byModel} labelHeader="Model" />
        </Panel>
        <Panel title="Features" sub="From the x-llmpense-feature header">
          <Breakdown rows={byFeature} labelHeader="Feature" />
        </Panel>
      </div>

      <div id="client-results" className="scroll-mt-28">
      <Panel
        title="Results"
        sub={`Cost per successful result for ${client.name}'s runs, failed attempts included. By outcome date.`}
        actions={
          <Link href={`/results${q}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
            All results
          </Link>
        }
      >
        {results.names.length === 0 && results.pending.runs === 0 ? (
          <p className="text-sm text-ink-2">
            No runs with outcomes for this client in this range.{" "}
            <Link href="/results" className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">
              How to send run ids and outcomes
            </Link>
          </p>
        ) : (
          <div className="space-y-4">
            {results.names.length > 0 && (
              <ResultTable
                rows={results.names}
                labelHeader="Outcome"
                href={(b) => `/results/${encodeURIComponent(b.name)}?${new URLSearchParams({ client: client.id, ...(q ? { range: range.key } : {}) })}`}
              />
            )}
            <PendingNote {...results.pending} />
          </div>
        )}
      </Panel>
      </div>

      <Panel
        title="Monthly statements"
        sub="What this client is billed per calendar month. Close a month to freeze it."
        actions={
          <Link href="/statements" className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
            All clients
          </Link>
        }
      >
        <ul className="-my-1 divide-y divide-line">
          {statementMonths.map((m) => {
            const st = statuses.get(m);
            const closed = !!st && st.status !== "draft";
            return (
              <li key={m}>
                <Link
                  href={`/clients/${client.id}/statements/${m}`}
                  className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{monthLabel(m)}</span>
                    <StatusBadge status={st?.status ?? "draft"} overdue={!!st && isOverdue(st.status, st.dueDate, today)} />
                    {m === thisMonth && <span className="text-[12px] text-ink-3">in progress</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[13px] text-ink-2">
                    {closed && st?.totalBilled != null && (
                      <span className="num">
                        {money(Number(st.totalBilled), st.currency ?? "USD")}
                        <span className="hidden text-ink-3 sm:inline"> · {st.number ?? `closed ${longDate(st.closedAt!)}`}</span>
                      </span>
                    )}
                    <ChevronRight size={16} className="text-ink-3" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
        <Panel title="Billing">
          <BillingForm
            id={client.id}
            billingMode={client.billingMode}
            markupPct={client.markupPct}
            fixedFee={client.fixedFee}
            currency={client.billingCurrency}
            modelNames={client.modelNames}
            orgShowModelNames={org.showModelNames}
            paymentTermsDays={client.paymentTermsDays}
            orgPaymentTermsDays={org.paymentTermsDays}
          />
        </Panel>
        <Panel title="Invoice export" sub="Requests, tokens, cost and billed amount per project and model for one month, as CSV.">
          <form action={`/clients/${client.id}/export`} method="get" className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Month (UTC)</span>
              <select name="month" className="field num" defaultValue={monthOptions[0]}>
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}
                    {m === thisMonth ? " (so far)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-quiet w-full sm:w-auto">
              <Download size={16} aria-hidden /> Download CSV
            </button>
            {client.billingMode === "fixed" && (
              <p className="text-[13px] text-ink-3">The file ends with the monthly fixed fee of {money(client.fixedFee, client.billingCurrency)} as its own line{client.billingCurrency !== "USD" ? ", converted to USD at the month's rate" : ""}.</p>
            )}
          </form>
        </Panel>
      </div>

      <FrozenNote />
    </div>
  );
}

function Fig({ label, value, d, loss = false }: { label: string; value: string; d: React.ReactNode; loss?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className={`mt-0.5 text-[20px] leading-7 font-semibold tracking-tight lg:text-[22px] ${loss ? "text-loss-ink" : ""}`}>{value}</dd>
      <dd>{d}</dd>
    </div>
  );
}

/** Explains the chart's billed line for the client's billing mode. */
function billingLineNote(c: { name: string; billingMode: string; markupPct: number; fixedFee: number; billingCurrency: Currency }): string {
  const bars = "Bars: what each project cost you per day.";
  switch (c.billingMode) {
    case "markup":
      return `${bars} Line: what ${c.name} was billed (cost + ${c.markupPct}%). The gap is your margin.`;
    case "passthrough":
      return `${bars} Line: what ${c.name} was billed. Billed at cost, so it sits on top of the bars.`;
    case "fixed":
      return `${bars} Line: each day's share of the ${money(c.fixedFee, c.billingCurrency)} monthly fixed fee${c.billingCurrency !== "USD" ? " in USD at each month's rate" : ""}. Where it sits above the bars, you keep the difference.`;
    default:
      return `${bars} You absorb this client's AI cost; nothing is billed.`;
  }
}
