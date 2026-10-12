import type { Metadata } from "next";
import { getCurrentOrg } from "@/lib/org.ts";
import { resultsOverview } from "@/lib/results.ts";
import { listClients } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { appBase, proxyBase } from "@/lib/base-url.ts";
import { EmptyState, PageHeader, Panel } from "@/components/ui.tsx";
import { PendingNote, ResultTable, ResultsSetup } from "@/components/results.tsx";

export const metadata: Metadata = { title: "Results" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ResultsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await getCurrentOrg();
  const [{ names, pending, hasData }, clients, app] = await Promise.all([
    resultsOverview({ orgId: org.id, range }),
    listClients(org.id),
    appBase(),
  ]);
  const q = range.key === "30d" ? "" : `?range=${range.key}`;
  const setup = <ResultsSetup proxy={proxyBase()} app={app} exampleClient={clients[0]?.slug ?? "acme-retail"} />;

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        title="Results"
        sub={<>What a successful result costs, failed attempts included. {range.label}, by outcome date.</>}
      />

      {!hasData ? (
        <Panel title="Measure cost per result" sub="Group the calls of one task into a run, then report how the run ended.">
          <div className="space-y-4">
            <EmptyState title="No runs or outcomes yet">
              A run is one task: a support ticket, a document, an agent run. Once runs report outcomes, this page shows what each successful
              result costs, by client, project and model.
            </EmptyState>
            {setup}
          </div>
        </Panel>
      ) : (
        <>
          <Panel
            title="Outcomes"
            sub="Cost per success = cost of every run that reported the outcome, successful or failed, divided by its successes."
          >
            <div className="space-y-4">
              <ResultTable rows={names} labelHeader="Outcome" href={(b) => `/results/${encodeURIComponent(b.name)}${q}`} />
              <PendingNote {...pending} />
            </div>
          </Panel>

          <details className="group rounded-xl border border-line bg-surface">
            <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[15px] font-semibold lg:px-5">
              How to send run ids and outcomes
            </summary>
            <div className="px-4 pb-4 lg:px-5">{setup}</div>
          </details>
        </>
      )}
    </div>
  );
}
