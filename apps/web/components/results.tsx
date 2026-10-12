import Link from "next/link";
import { ChevronRight, Hourglass, Trophy } from "lucide-react";
import { HEADERS, LOW_SAMPLE_RUNS, outcomeLabel } from "@llmpense/core";
import type { ResultBucket } from "@/lib/results.ts";
import { count, pct, usd, usdPer } from "@/lib/format.ts";
import { CodeBlock } from "./copy-button.tsx";
import { EmptyState } from "./ui.tsx";

const TAG = "inline-flex items-center gap-1 rounded-md px-1.5 text-xs leading-5 font-medium whitespace-nowrap";

export function LowSampleTag() {
  return (
    <span className={`${TAG} border border-line-strong text-ink-2`} title={`Fewer than ${LOW_SAMPLE_RUNS} runs: treat these numbers with care`}>
      Low sample
    </span>
  );
}

export function CheapestTag() {
  return (
    <span className={`${TAG} bg-accent-soft text-accent`}>
      <Trophy size={12} strokeWidth={2.25} aria-hidden />
      Cheapest per success
    </span>
  );
}

/** "ticket_resolved" shown as "Ticket resolved" with the raw name underneath. */
export function OutcomeName({ name, className = "" }: { name: string; className?: string }) {
  return (
    <span className={`flex min-w-0 flex-col ${className}`}>
      <span className="truncate font-medium">{outcomeLabel(name)}</span>
      <span className="truncate font-mono text-[12px] text-ink-3">{name}</span>
    </span>
  );
}

const cps = (b: ResultBucket) => (b.costPerSuccess === null ? "–" : usdPer(b.costPerSuccess));
const vpd = (b: ResultBucket) => (b.valuePerDollar === null ? "–" : usd(b.valuePerDollar));

/**
 * Buckets of one breakdown (outcome names, clients, projects). Phones get one card per row with
 * the cost per success up front; desktop gets the full table.
 */
export function ResultTable({
  rows,
  labelHeader,
  href,
  empty = "No outcomes in this range",
}: {
  rows: ResultBucket[];
  labelHeader: string;
  href?: (b: ResultBucket) => string;
  empty?: string;
}) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  const showValue = rows.some((r) => r.valuePerDollar !== null);
  const label = (b: ResultBucket) =>
    labelHeader === "Outcome" ? (
      <OutcomeName name={b.name} />
    ) : (
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{b.label}</span>
        {b.sub && <span className="truncate text-[12px] text-ink-3">{b.sub}</span>}
      </span>
    );

  return (
    <>
      <ul className="-my-1 divide-y divide-line lg:hidden">
        {rows.map((b) => {
          const inner = (
            <>
              <div className="flex items-start justify-between gap-3">
                {label(b)}
                <span className="shrink-0 text-right">
                  <span className="num block text-[17px] leading-6 font-semibold">{cps(b)}</span>
                  <span className="block text-[12px] text-ink-3">per success</span>
                </span>
              </div>
              <p className="num mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-2">
                <span>
                  {pct(b.successRate, 0)} of {count(b.runs)} runs succeeded
                </span>
                <span aria-hidden>·</span>
                <span>{b.costPerRun === null ? "–" : usdPer(b.costPerRun)} per run</span>
                {b.valuePerDollar !== null && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{vpd(b)} value per $1</span>
                  </>
                )}
                {b.lowSample && <LowSampleTag />}
              </p>
            </>
          );
          const key = `${b.name}/${b.key ?? "null"}`;
          return (
            <li key={key}>
              {href ? (
                <Link href={href(b)} className="-mx-2 flex min-h-11 items-center gap-2 rounded-lg px-2 py-3 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">{inner}</div>
                  <ChevronRight size={16} className="shrink-0 text-ink-3" aria-hidden />
                </Link>
              ) : (
                <div className="py-3">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="-mx-5 hidden overflow-x-auto lg:block">
        <table className="dtable">
          <thead>
            <tr>
              <th className="pl-5">{labelHeader}</th>
              <th className="r">Runs</th>
              <th className="r">Successes</th>
              <th className="r">Success rate</th>
              <th className="r">Cost per success</th>
              <th className="r">Cost per run</th>
              <th className="r">Total cost</th>
              {showValue && <th className="r">Value per $1</th>}
              <th className="pr-5">
                <span className="sr-only">Notes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={`${b.name}/${b.key ?? "null"}`}>
                <td className="max-w-[280px] pl-5">
                  {href ? (
                    <Link href={href(b)} className="-my-2 flex min-h-11 items-center hover:underline">
                      {label(b)}
                    </Link>
                  ) : (
                    label(b)
                  )}
                </td>
                <td className="r">{count(b.runs)}</td>
                <td className="r">{count(b.successes)}</td>
                <td className="r">{pct(b.successRate)}</td>
                <td className="r font-semibold">{cps(b)}</td>
                <td className="r">{b.costPerRun === null ? "–" : usdPer(b.costPerRun)}</td>
                <td className="r">{usd(b.costUsd)}</td>
                {showValue && <td className="r">{vpd(b)}</td>}
                <td className="pr-5 whitespace-nowrap">{b.lowSample && <LowSampleTag />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Cost per success per model, cheapest first. Bars share one scale; the numbers next to them
 * carry the values, so the bars are decorative for screen readers.
 */
export function ModelComparison({ rows, cheapest }: { rows: ResultBucket[]; cheapest: number | null }) {
  if (rows.length === 0) return <EmptyState title="No outcomes in this range" />;
  const max = Math.max(...rows.map((r) => r.costPerSuccess ?? 0)) || 1;
  return (
    <ul className="space-y-4">
      {rows.map((r, i) => (
        <li key={r.key ?? "null"}>
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium break-all">{r.label}</span>
              {r.sub && <span className="text-[12px] text-ink-3">{r.sub}</span>}
              {i === cheapest && <CheapestTag />}
              {r.lowSample && <LowSampleTag />}
            </span>
            <span className="num shrink-0 text-right font-semibold">
              {cps(r)} <span className="block text-[12px] font-normal text-ink-3 sm:inline">per success</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-surface-2" aria-hidden>
            {r.costPerSuccess !== null && (
              <div className="h-full rounded-full" style={{ width: `${Math.max(1, (r.costPerSuccess / max) * 100)}%`, background: "var(--s1)" }} />
            )}
          </div>
          <p className="num mt-1 text-[12px] text-ink-3">
            {count(r.runs)} runs, {count(r.successes)} succeeded ({pct(r.successRate, 0)}), {usd(r.costUsd)} total
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Compact cost-per-result summary for the overview: the outcomes with the most runs. On phones it
 * is the way into the Results page, which has no bottom tab.
 */
export function ResultsCard({
  names,
  pending,
  hasData,
  q,
}: {
  names: ResultBucket[];
  pending: { runs: number; costUsd: number };
  hasData: boolean;
  q: string;
}) {
  const top = names.slice(0, 3);
  return (
    <section aria-labelledby="results-card" className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 pt-1 pr-1 pl-4 lg:pl-5">
        <h2 id="results-card" className="text-[15px] font-semibold">
          Cost per result
        </h2>
        <Link href={`/results${q}`} className="inline-flex min-h-11 items-center gap-0.5 rounded-lg px-3 text-sm font-medium text-accent hover:underline">
          {hasData ? "Results" : "Set up"}
          <ChevronRight size={16} aria-hidden />
        </Link>
      </header>
      <div className="px-4 pb-4 lg:px-5">
        {!hasData ? (
          <p className="text-sm text-ink-2">Tag the calls of one task with a run id and report its outcome to see what each successful result costs.</p>
        ) : top.length === 0 ? (
          <p className="text-sm text-ink-2">No outcomes reported in this range.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            {top.map((b) => (
              <li key={b.name} className="min-w-0">
                <Link href={`/results/${encodeURIComponent(b.name)}${q}`} className="group block min-h-11 rounded-lg hover:bg-surface-2 sm:-mx-2 sm:px-2 sm:py-1">
                  <span className="flex items-baseline justify-between gap-3 sm:block">
                    <span className="block truncate text-[13px] text-ink-2 group-hover:text-ink">{outcomeLabel(b.name)}</span>
                    <span className="num text-[20px] leading-7 font-semibold tracking-tight">
                      {b.costPerSuccess === null ? "–" : usdPer(b.costPerSuccess)}
                    </span>
                  </span>
                  <span className="num block text-[12px] text-ink-3">
                    per success, {pct(b.successRate, 0)} of {count(b.runs)} runs
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {hasData && pending.runs > 0 && (
          <p className="num mt-3 border-t border-line pt-2 text-[12px] text-ink-3">
            {count(pending.runs)} {pending.runs === 1 ? "run" : "runs"} ({usd(pending.costUsd)}) still waiting for an outcome
          </p>
        )}
      </div>
    </section>
  );
}

/** Runs that already cost money but have not reported an outcome. */
export function PendingNote({ runs, costUsd }: { runs: number; costUsd: number }) {
  if (runs === 0) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
      <Hourglass size={15} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        <span className="num font-medium text-ink">{count(runs)}</span> {runs === 1 ? "run has" : "runs have"} no outcome yet:{" "}
        <span className="num font-medium text-ink">{usd(costUsd)}</span> already spent, result pending. They are not part of the numbers
        above until an outcome is reported.
      </span>
    </p>
  );
}

/** Copyable snippets: tag calls with a run id, then report the outcome. */
export function ResultsSetup({ proxy, app, exampleClient }: { proxy: string; app: string; exampleClient: string }) {
  const header = `import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: "${proxy}/openai/v1",
  defaultHeaders: {
    "${HEADERS.key}": process.env.LLMPENSE_KEY,
    "${HEADERS.client}": "${exampleClient}",
    "${HEADERS.project}": "support-bot",
  },
});

// Every call that works on ticket 4711 carries the same run id.
await openai.chat.completions.create(
  { model: "gpt-5-mini", messages },
  { headers: { "${HEADERS.run}": "ticket-4711" } },
);`;
  const curl = `curl -X POST "${app}/api/v1/outcomes" \\
  -H "Authorization: Bearer lpk_..." \\
  -H "content-type: application/json" \\
  -d '{
    "outcomes": [{
      "runId": "ticket-4711",
      "name": "ticket_resolved",
      "status": "success",
      "value": { "amount": 4, "currency": "USD" }
    }]
  }'`;
  return (
    <div className="space-y-3">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
        <li>
          Give every LLM call that works on one task the same run id: the <code className="text-ink">{HEADERS.run}</code> header on the proxy,{" "}
          <code className="text-ink">runId</code> in the ingest API, or the <code className="text-ink">llmpense_run</code> metadata key (or a{" "}
          <code className="text-ink">run:&lt;id&gt;</code> tag) in LiteLLM, Helicone and OpenRouter.
        </li>
        <li>
          When the task is done, report how it ended. Reporting the same run and name again updates it, and outcomes may arrive before the
          usage.
        </li>
      </ol>
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <CodeBlock label="1. Run id on the proxy, TypeScript" code={header} />
        <CodeBlock label="2. Outcomes API, curl" code={curl} />
      </div>
      <p className="text-[13px] text-ink-3">
        Up to 1,000 outcomes per call. <code>status</code> is <code>success</code> or <code>failure</code>; <code>value</code> (optional) is
        what the result is worth, in USD, EUR, GBP, JPY, CNY or CHF; <code>ts</code> and <code>metadata</code> are optional.
      </p>
    </div>
  );
}
