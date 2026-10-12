import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, X } from "lucide-react";
import { LOW_SAMPLE_RUNS, OUTCOME_NAME_PATTERN, outcomeLabel } from "@llmpense/core";
import { getCurrentOrg } from "@/lib/org.ts";
import { outcomeDetail } from "@/lib/results.ts";
import { getClient } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { count, pct, usd, usdPer } from "@/lib/format.ts";
import { EmptyState, Panel } from "@/components/ui.tsx";
import { LowSampleTag, ModelComparison, ResultTable } from "@/components/results.tsx";
import { ResultChart } from "@/components/result-chart.tsx";

type Props = {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function parseName(raw: string): string | null {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return OUTCOME_NAME_PATTERN.test(name) ? name : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const name = parseName((await params).name);
  return { title: name ? outcomeLabel(name) : "Results" };
}

export default async function OutcomePage({ params, searchParams }: Props) {
  const [{ name: raw }, sp] = await Promise.all([params, searchParams]);
  const name = parseName(raw);
  if (!name) notFound();
  const range = resolveRange(sp.range);
  const org = await getCurrentOrg();
  const client = typeof sp.client === "string" ? await getClient(org.id, sp.client) : undefined;
  const detail = await outcomeDetail({ orgId: org.id, range, clientId: client?.id }, name);
  const rangeQ = range.key === "30d" ? "" : `range=${range.key}`;
  const back = client ? `/clients/${client.id}${rangeQ ? `?${rangeQ}` : ""}` : `/results${rangeQ ? `?${rangeQ}` : ""}`;
  const unfiltered = `/results/${encodeURIComponent(name)}${rangeQ ? `?${rangeQ}` : ""}`;

  return (
    <div className="space-y-5 lg:space-y-6">
      <div>
        <Link href={back} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-ink-2 hover:text-ink">
          <ChevronLeft size={16} aria-hidden /> {client ? client.name : "Results"}
        </Link>
        <h1 className="mt-1 text-[26px] leading-8 font-semibold tracking-tight lg:text-[30px] lg:leading-9">{outcomeLabel(name)}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
          <code className="font-mono text-[13px] text-ink-3">{name}</code>
          <span aria-hidden>·</span>
          <span>{range.label}, by outcome date</span>
          {client && (
            <Link
              href={unfiltered}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-accent hover:underline"
              aria-label={`Remove filter: ${client.name}`}
            >
              {client.name} only <X size={14} aria-hidden />
            </Link>
          )}
        </p>
      </div>

      {!detail ? (
        <EmptyState title="No outcomes with this name in this range">Pick a longer range, or check the name the outcomes are sent with.</EmptyState>
      ) : (
        <>
          <section aria-label="Key figures" className="rounded-xl border border-line bg-surface p-4 lg:p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
              <Fig
                label="Cost per success"
                value={detail.total.costPerSuccess === null ? "–" : usdPer(detail.total.costPerSuccess)}
                note="failed runs included"
              />
              <Fig label="Success rate" value={pct(detail.total.successRate)} note={`${count(detail.total.successes)} of ${count(detail.total.runs)} runs`} />
              <Fig label="Cost per run" value={detail.total.costPerRun === null ? "–" : usdPer(detail.total.costPerRun)} note="average" />
              <Fig label="Total cost" value={usd(detail.total.costUsd)} note={`${count(detail.total.failures)} failed runs`} />
              <Fig
                label="Value per $1"
                value={detail.total.valuePerDollar === null ? "–" : usd(detail.total.valuePerDollar)}
                note={detail.total.successValueUsd === null ? "no values reported" : `${usd(detail.total.successValueUsd)} value`}
              />
              <Fig
                label="Runs"
                value={count(detail.total.runs)}
                note={detail.total.lowSample ? <LowSampleTag /> : detail.total.runsWithoutUsage ? `${count(detail.total.runsWithoutUsage)} without usage yet` : "with this outcome"}
              />
            </dl>
            {(detail.total.runsWithoutUsage > 0 || detail.total.missingRates > 0) && (
              <ul className="mt-4 space-y-1 border-t border-line pt-3 text-[13px] text-ink-3">
                {detail.total.runsWithoutUsage > 0 && (
                  <li>
                    {count(detail.total.runsWithoutUsage)} {detail.total.runsWithoutUsage === 1 ? "run reported" : "runs reported"} this outcome
                    but no usage with its run id has arrived yet; it counts with zero cost until it does.
                  </li>
                )}
                {detail.total.missingRates > 0 && <li>Some values are in a currency without a known exchange rate and are left out of value per $1.</li>}
              </ul>
            )}
          </section>

          <Panel title="Daily cost per success" sub="Cost of the runs that reported the outcome that day, divided by that day's successes. No bar: no success that day.">
            <ResultChart data={detail.daily} caption={`Daily cost per success for ${outcomeLabel(name)}, ${range.label}`} />
          </Panel>

          <Panel
            title="Cost per success by model"
            sub={`Cheapest first. A run counts under a model when all its calls used it. Fewer than ${LOW_SAMPLE_RUNS} runs is a low sample.`}
          >
            <ModelComparison rows={detail.byModel} cheapest={detail.cheapestModel} />
          </Panel>

          {!client && (
            <Panel title="By client">
              <ResultTable rows={detail.byClient} labelHeader="Client" />
            </Panel>
          )}

          <Panel title="By project">
            <ResultTable rows={detail.byProject} labelHeader="Project" />
          </Panel>
        </>
      )}
    </div>
  );
}

function Fig({ label, value, note }: { label: string; value: string; note: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="num mt-0.5 text-[20px] leading-7 font-semibold tracking-tight lg:text-[22px]">{value}</dd>
      <dd className="text-[12px] text-ink-3">{note}</dd>
    </div>
  );
}
