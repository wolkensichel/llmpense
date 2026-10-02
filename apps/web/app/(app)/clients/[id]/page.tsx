import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Download } from "lucide-react";
import { getCurrentOrg } from "@/lib/org.ts";
import { clientBreakdown, clientDaily, clientMargins, clientMonths, getClient, listProjects } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { compactNum, count, delta, pct, usd } from "@/lib/format.ts";
import { DailyChart, type Series } from "@/components/daily-chart.tsx";
import { Breakdown } from "@/components/breakdown.tsx";
import { BillingBadge, ClientDot, Delta, FrozenNote, LossTag, MarginBar, MarginBarLegend, Panel } from "@/components/ui.tsx";
import { BillingForm } from "./billing-form.tsx";

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

  const [margins, daily, byProject, byModel, byFeature, projects, months] = await Promise.all([
    clientMargins(org.id, range),
    clientDaily(org.id, client, range),
    clientBreakdown(org.id, client.id, range, "project"),
    clientBreakdown(org.id, client.id, range, "model"),
    clientBreakdown(org.id, client.id, range, "feature"),
    listProjects(org.id),
    clientMonths(org.id, client.id),
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
  const thisMonth = now.toISOString().slice(0, 7);
  const monthOptions = months.length ? months : [thisMonth];

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <Link href={`/clients${q}`} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft size={16} aria-hidden /> Clients
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <ClientDot slot={client.slot} className="size-3" />
          <h1 className="text-[26px] leading-8 font-semibold tracking-tight lg:text-[30px] lg:leading-9">{client.name}</h1>
          <BillingBadge mode={client.billingMode} markupPct={client.markupPct} fixedFeeUsd={client.fixedFeeUsd} />
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
        <Panel title="Billing">
          <BillingForm id={client.id} billingMode={client.billingMode} markupPct={client.markupPct} fixedFeeUsd={client.fixedFeeUsd} />
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
              <p className="text-[13px] text-ink-3">The file ends with the monthly fixed fee of {usd(client.fixedFeeUsd)} as its own line.</p>
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
function billingLineNote(c: { name: string; billingMode: string; markupPct: number; fixedFeeUsd: number }): string {
  const bars = "Bars: what each project cost you per day.";
  switch (c.billingMode) {
    case "markup":
      return `${bars} Line: what ${c.name} was billed (cost + ${c.markupPct}%). The gap is your margin.`;
    case "passthrough":
      return `${bars} Line: what ${c.name} was billed. Billed at cost, so it sits on top of the bars.`;
    case "fixed":
      return `${bars} Line: each day's share of the ${usd(c.fixedFeeUsd)} monthly fixed fee. Where it sits above the bars, you keep the difference.`;
    default:
      return `${bars} You absorb this client's AI cost; nothing is billed.`;
  }
}
