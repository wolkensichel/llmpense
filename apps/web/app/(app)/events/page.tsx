import type { Metadata } from "next";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { PROVIDERS } from "@llmpense/core";
import { getCurrentOrg } from "@/lib/org.ts";
import { EVENTS_PAGE, listClients, listEvents, listModels, listProjects, unpricedCount, type EventFilters } from "@/lib/queries.ts";
import { resolveRange } from "@/lib/range.ts";
import { compactNum, count, dateTime, usdFine } from "@/lib/format.ts";
import { ClientDot, EmptyState, PageHeader } from "@/components/ui.tsx";

export const metadata: Metadata = { title: "Events" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const UUID = /^[0-9a-f-]{36}$/i;

export default async function EventsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const range = resolveRange(sp.range);
  const org = await getCurrentOrg();

  const client = one(sp.client);
  const project = one(sp.project);
  const provider = one(sp.provider);
  const filters: EventFilters = {
    client: client === "none" || (client && UUID.test(client)) ? client : undefined,
    project: project && UUID.test(project) ? project : undefined,
    model: one(sp.model),
    provider: provider && (PROVIDERS as readonly string[]).includes(provider) ? provider : undefined,
    unpriced: sp.unpriced === "1",
    cursor: Number(one(sp.cursor)) > 0 ? Number(one(sp.cursor)) : undefined,
  };

  const [{ events, nextCursor }, clients, projects, models, unpriced] = await Promise.all([
    listEvents(org.id, range, filters),
    listClients(org.id),
    listProjects(org.id),
    listModels(org.id),
    unpricedCount(org.id, range),
  ]);
  const slotOf = new Map(clients.map((c) => [c.id, c.slot]));
  const active = [filters.client, filters.project, filters.model, filters.provider, filters.unpriced || undefined].filter(Boolean).length;

  const base = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v && k !== "cursor") base.set(k, v);
  const olderHref = nextCursor ? `/events?${new URLSearchParams({ ...Object.fromEntries(base), cursor: String(nextCursor) })}` : null;
  const newestHref = `/events${base.size ? `?${base}` : ""}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Events"
        sub={
          <>
            Every recorded request, newest first. {range.label}.
            {unpriced > 0 && !filters.unpriced && (
              <>
                {" "}
                <Link className="font-medium text-warn-ink underline" href={`/events?${new URLSearchParams({ ...Object.fromEntries(base), unpriced: "1" })}`}>
                  {count(unpriced)} not priced
                </Link>
              </>
            )}
          </>
        }
      />

      <details className="group rounded-xl border border-line bg-surface lg:open:pb-0" open={active > 0 ? true : undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium">
          <SlidersHorizontal size={16} aria-hidden />
          Filters
          {active > 0 && <span className="num rounded-full bg-accent px-1.5 text-xs leading-5 text-on-accent">{active}</span>}
          <span className="ml-auto text-[13px] font-normal text-ink-3 group-open:hidden">Show</span>
          <span className="ml-auto hidden text-[13px] font-normal text-ink-3 group-open:inline">Hide</span>
        </summary>
        <form method="get" action="/events" className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto] lg:items-end">
          {range.key !== "30d" && <input type="hidden" name="range" value={range.key} />}
          <Select label="Client" name="client" value={filters.client}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Unattributed</option>
          </Select>
          <Select label="Project" name="project" value={filters.project}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} / {p.name}
              </option>
            ))}
          </Select>
          <Select label="Provider" name="provider" value={filters.provider}>
            <option value="">All providers</option>
            {[...new Set(models.map((m) => m.provider))].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Select label="Model" name="model" value={filters.model}>
            <option value="">All models</option>
            {models.map((m) => (
              <option key={`${m.provider}/${m.model}`} value={m.model}>
                {m.model}
              </option>
            ))}
          </Select>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="unpriced" value="1" defaultChecked={filters.unpriced} className="size-4 accent-[var(--accent)]" />
            Not priced only
          </label>
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1">Apply</button>
            {active > 0 && (
              <Link href={range.key === "30d" ? "/events" : `/events?range=${range.key}`} className="btn btn-quiet">
                Clear
              </Link>
            )}
          </div>
        </form>
      </details>

      {events.length === 0 ? (
        <EmptyState title="No events match">Widen the date range or clear filters.</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface lg:hidden">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[14px] font-medium">
                      <ClientDot slot={e.clientId ? (slotOf.get(e.clientId) ?? 0) : 0} />
                      <span className="truncate">{e.clientName ?? "Unattributed"}</span>
                      {e.projectName && <span className="truncate font-normal text-ink-2">/ {e.projectName}</span>}
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-ink-2">
                      {e.model}
                      {e.feature ? `, ${e.feature}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="num text-[14px] font-medium">{e.priced ? usdFine(e.costUsd) : <NotPriced />}</p>
                    <p className="num text-[12px] text-ink-3">billed {usdFine(e.billedUsd)}</p>
                  </div>
                </div>
                <p className="num mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                  <span>{dateTime(e.ts)}</span>
                  <span>
                    {compactNum(e.inputTokens + e.cacheReadTokens + e.cacheWriteTokens)} in, {compactNum(e.outputTokens)} out
                  </span>
                  {e.status && e.status >= 400 && <span className="text-loss-ink">HTTP {e.status}</span>}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface lg:block">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Time (UTC)</th>
                  <th>Client / project</th>
                  <th>Feature</th>
                  <th>Model</th>
                  <th className="r">Input</th>
                  <th className="r">Cached</th>
                  <th className="r">Output</th>
                  <th className="r">Cost</th>
                  <th className="r">Billed</th>
                  <th className="r">Latency</th>
                  <th className="r">Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="num whitespace-nowrap text-ink-2">{dateTime(e.ts)}</td>
                    <td>
                      <span className="flex items-center gap-2">
                        <ClientDot slot={e.clientId ? (slotOf.get(e.clientId) ?? 0) : 0} />
                        <span className="truncate">{e.clientName ?? <span className="text-ink-3">Unattributed</span>}</span>
                        {e.projectName && <span className="truncate text-ink-3">/ {e.projectName}</span>}
                      </span>
                    </td>
                    <td className="text-ink-2">{e.feature ?? "–"}</td>
                    <td>
                      {e.model}
                      <span className="ml-1.5 text-[12px] text-ink-3">{e.provider}</span>
                    </td>
                    <td className="r">{count(e.inputTokens)}</td>
                    <td className="r">{count(e.cacheReadTokens + e.cacheWriteTokens)}</td>
                    <td className="r">{count(e.outputTokens)}</td>
                    <td className="r font-medium">{e.priced ? usdFine(e.costUsd) : <NotPriced />}</td>
                    <td className="r">{usdFine(e.billedUsd)}</td>
                    <td className="r text-ink-2">{e.latencyMs !== null ? `${count(e.latencyMs)} ms` : "–"}</td>
                    <td className={`r ${e.status && e.status >= 400 ? "text-loss-ink" : "text-ink-2"}`}>{e.status ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav aria-label="Pages" className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-ink-3">{filters.cursor ? "Older events" : `Latest ${Math.min(events.length, EVENTS_PAGE)}`}</p>
            <div className="flex gap-2">
              {filters.cursor && (
                <Link href={newestHref} className="btn btn-quiet">
                  Newest
                </Link>
              )}
              {olderHref && (
                <Link href={olderHref} className="btn btn-quiet">
                  Older
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function NotPriced() {
  return (
    <span className="inline-flex items-center rounded-md bg-warn/20 px-1.5 text-xs leading-5 font-medium text-warn-ink" title="No price matched this model. Add a price override in Settings.">
      Not priced
    </span>
  );
}

function Select({ label, name, value, children }: { label: string; name: string; value?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      <select name={name} defaultValue={value ?? ""} className="field">
        {children}
      </select>
    </label>
  );
}
