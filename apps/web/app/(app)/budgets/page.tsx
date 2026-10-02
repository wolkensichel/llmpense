import type { Metadata } from "next";
import { CircleAlert, OctagonAlert, Trash2 } from "lucide-react";
import { getCurrentOrg } from "@/lib/org.ts";
import { budgetsWithSpend, listAlerts, listClients, listProjects } from "@/lib/queries.ts";
import { usd } from "@/lib/format.ts";
import { AlertList } from "@/components/alert-list.tsx";
import { ClientDot, EmptyState, PageHeader, Panel } from "@/components/ui.tsx";
import { acknowledgeAll, deleteBudget } from "./actions.ts";
import { BudgetForm } from "./budget-form.tsx";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const org = await getCurrentOrg();
  const now = new Date();
  const [budgets, alerts, clients, projects] = await Promise.all([
    budgetsWithSpend(org.id, now),
    listAlerts(org.id, { limit: 30 }),
    listClients(org.id),
    listProjects(org.id),
  ]);
  const slotOf = new Map(clients.map((c) => [c.id, c.slot]));
  const open = alerts.filter((a) => !a.acknowledgedAt).length;
  const month = now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader title="Budgets and alerts" sub={`Provider spend in ${month} so far, against each monthly limit.`} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
        <Panel title="Budgets" sub="Month to date, with a straight-line projection to month end">
          {budgets.length === 0 ? (
            <EmptyState title="No budgets yet">Create one to get alerts when spend crosses a threshold.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {budgets.map((b) => {
                const over = b.pct >= 1;
                const near = !over && b.pct >= 0.8;
                const projectedOver = b.projected > b.amount;
                const fill = over ? "var(--loss)" : near ? "var(--warn)" : "var(--accent)";
                return (
                  <li key={b.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-medium">
                          {b.scope !== "org" && <ClientDot slot={b.clientId ? (slotOf.get(b.clientId) ?? 0) : 0} />}
                          <span className="truncate">{b.name}</span>
                        </p>
                        <p className="text-[13px] text-ink-3">{b.scope === "org" ? "Agency" : b.scope === "client" ? "Client" : "Project"} budget</p>
                      </div>
                      <div className="flex items-start gap-1">
                        <p className="num text-right text-[14px]">
                          <span className="font-semibold">{usd(b.spend)}</span>
                          <span className="text-ink-3"> of {usd(b.amount)}</span>
                        </p>
                        <form action={deleteBudget}>
                          <input type="hidden" name="id" value={b.id} />
                          <button
                            aria-label={`Delete budget for ${b.name}`}
                            title="Delete budget"
                            className="-mt-2.5 -mr-2 inline-flex size-11 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-loss-ink"
                          >
                            <Trash2 size={16} aria-hidden />
                          </button>
                        </form>
                      </div>
                    </div>
                    <div className="relative mt-2 h-2.5 rounded-[3px] bg-surface-2" role="img" aria-label={`${Math.round(b.pct * 100)}% of budget used`}>
                      <div className="h-full rounded-[3px]" style={{ width: `${Math.min(100, b.pct * 100)}%`, background: fill }} />
                      {b.thresholds
                        .filter((t) => t < 100)
                        .map((t) => (
                          <span key={t} aria-hidden className="absolute top-[-3px] bottom-[-3px] w-[2px] bg-surface" style={{ left: `${t}%` }} />
                        ))}
                    </div>
                    <p className="num mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className={over ? "inline-flex items-center gap-1 font-medium text-loss-ink" : near ? "inline-flex items-center gap-1 font-medium text-warn-ink" : "text-ink-2"}>
                        {over && <OctagonAlert size={14} aria-hidden />}
                        {near && <CircleAlert size={14} aria-hidden />}
                        {Math.round(b.pct * 100)}% used{over ? ", over budget" : ""}
                      </span>
                      <span className={projectedOver && !over ? "text-warn-ink" : "text-ink-3"}>Projected {usd(b.projected)}</span>
                      <span className="text-ink-3">Alerts at {b.thresholds.join(", ")}%</span>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="New budget">
          <BudgetForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} projects={projects} />
        </Panel>
      </div>

      <Panel
        title="Alerts"
        sub={open > 0 ? `${open} open` : "All caught up"}
        actions={
          open > 1 ? (
            <form action={acknowledgeAll}>
              <button className="btn btn-quiet min-h-11 px-3 text-[13px]">Acknowledge all</button>
            </form>
          ) : undefined
        }
      >
        {alerts.length === 0 ? <EmptyState title="No alerts yet" /> : <AlertList items={alerts} />}
      </Panel>
    </div>
  );
}
