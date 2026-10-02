import type { Metadata } from "next";
import { headers } from "next/headers";
import { HEADERS } from "@llmpense/core";
import { getCurrentOrg } from "@/lib/org.ts";
import { listApiKeys, listClients, listPriceOverrides, listProjects } from "@/lib/queries.ts";
import { dateTime } from "@/lib/format.ts";
import { CodeBlock } from "@/components/copy-button.tsx";
import { EmptyState, PageHeader, Panel } from "@/components/ui.tsx";
import { revokeApiKey } from "./actions.ts";
import { KeyForm, PriceForm } from "./forms.tsx";

export const metadata: Metadata = { title: "Settings" };

function proxyBase(): string {
  const raw = (process.env.PROXY_PUBLIC_URL ?? `localhost:${process.env.PROXY_PORT ?? 8787}`).replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
}

async function appBase(): Promise<string> {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

const rate = (v: string | null) => (v === null ? "–" : `$${Number(v)}`);

export default async function SettingsPage() {
  const org = await getCurrentOrg();
  const [keys, clients, projects, prices, app] = await Promise.all([
    listApiKeys(org.id),
    listClients(org.id),
    listProjects(org.id),
    listPriceOverrides(org.id),
    appBase(),
  ]);
  const proxy = proxyBase();
  const exampleClient = clients[0]?.slug ?? "acme-retail";

  const openai = `from openai import OpenAI

client = OpenAI(
    base_url="${proxy}/openai/v1",
    default_headers={
        "${HEADERS.key}": "lpk_...",
        "${HEADERS.client}": "${exampleClient}",
        "${HEADERS.project}": "support-bot",
        "${HEADERS.feature}": "chat",
    },
)`;
  const anthropic = `import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  baseURL: "${proxy}/anthropic",
  defaultHeaders: {
    "${HEADERS.key}": "lpk_...",
    "${HEADERS.client}": "${exampleClient}",
    "${HEADERS.project}": "support-bot",
    "${HEADERS.feature}": "summarize",
  },
});`;
  const gemini = `curl "${proxy}/gemini/v1beta/models/gemini-2.5-flash:generateContent" \\
  -H "x-goog-api-key: $GEMINI_API_KEY" \\
  -H "${HEADERS.key}: lpk_..." \\
  -H "${HEADERS.client}: ${exampleClient}" \\
  -H "${HEADERS.project}: support-bot" \\
  -H "content-type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'`;
  const ingest = `curl -X POST "${app}/api/v1/events" \\
  -H "Authorization: Bearer lpk_..." \\
  -H "content-type: application/json" \\
  -d '{
    "events": [{
      "provider": "openai",
      "model": "gpt-5-mini",
      "client": "${exampleClient}",
      "project": "support-bot",
      "feature": "chat",
      "inputTokens": 1200,
      "outputTokens": 350,
      "requestId": "req_123"
    }]
  }'`;

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader title="Settings" sub={org.name} />

      <nav aria-label="Settings sections" className="-mt-2 flex gap-1 text-sm">
        {[
          ["#connect", "Connect"],
          ["#keys", "API keys"],
          ["#prices", "Prices"],
        ].map(([href, label]) => (
          <a key={href} href={href} className="inline-flex min-h-11 items-center rounded-lg px-3 text-ink-2 hover:bg-surface-2 hover:text-ink">
            {label}
          </a>
        ))}
      </nav>

      <section id="connect" className="scroll-mt-28">
        <Panel
          title="Connect your apps"
          sub={
            <>
              Point your SDK at the LLMpense proxy and add attribution headers. Provider keys pass through unchanged; every{" "}
              <code className="text-ink-2">x-llmpense-*</code> header is stripped before the request leaves.
            </>
          }
        >
          <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-ink-2">OpenAI base URL</dt>
            <dd className="font-mono text-[13px] break-all">{proxy}/openai/v1</dd>
            <dt className="text-ink-2">Anthropic base URL</dt>
            <dd className="font-mono text-[13px] break-all">{proxy}/anthropic</dd>
            <dt className="text-ink-2">Gemini base URL</dt>
            <dd className="font-mono text-[13px] break-all">{proxy}/gemini</dd>
            <dt className="text-ink-2">Headers</dt>
            <dd className="text-[13px]">
              <code>{HEADERS.key}</code> (required), <code>{HEADERS.client}</code>, <code>{HEADERS.project}</code>, <code>{HEADERS.feature}</code>
            </dd>
          </dl>
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            <CodeBlock label="OpenAI, Python" code={openai} />
            <CodeBlock label="Anthropic, TypeScript" code={anthropic} />
            <CodeBlock label="Gemini, curl" code={gemini} />
            <CodeBlock label="Ingest API, curl" code={ingest} />
          </div>
          <p className="mt-3 text-[13px] text-ink-3">
            Not using the proxy? Send usage you already have to the ingest API, up to 1,000 events per call. Repeated{" "}
            <code>requestId</code> values are ignored, so retries are safe.
          </p>
        </Panel>
      </section>

      <section id="keys" className="scroll-mt-28">
        <Panel title="API keys" sub="Used as x-llmpense-key for the proxy and as a Bearer token for the ingest API.">
          <KeyForm clients={clients.map((c) => ({ id: c.id, name: c.name }))} projects={projects} />
          <div className="mt-5">
            {keys.length === 0 ? (
              <EmptyState title="No keys yet" />
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {keys.map((k) => (
                  <li key={k.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-3 ${k.revokedAt ? "opacity-60" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 font-medium">
                        {k.name}
                        <code className="rounded bg-surface-2 px-1.5 font-mono text-[12px] font-normal text-ink-2">{k.prefix}…</code>
                        {k.revokedAt && <span className="text-[12px] font-normal text-loss-ink">Revoked</span>}
                      </p>
                      <p className="text-[13px] text-ink-3">
                        {k.clientName ? `Defaults to ${k.clientName}${k.projectName ? ` / ${k.projectName}` : ""}. ` : ""}
                        {k.lastUsedAt ? `Last used ${dateTime(k.lastUsedAt)} UTC.` : "Never used."} Created {dateTime(k.createdAt)}.
                      </p>
                    </div>
                    {!k.revokedAt && (
                      <form action={revokeApiKey}>
                        <input type="hidden" name="id" value={k.id} />
                        <button className="btn btn-quiet min-h-11 px-3 text-[13px] text-loss-ink">Revoke</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </section>

      <section id="prices" className="scroll-mt-28">
        <Panel
          title="Price overrides"
          sub="LLMpense ships with list prices. Add a row for a negotiated discount or a model it doesn't know yet. Agency rows win over server-wide rows; the latest effective date wins."
        >
          <PriceForm />
          <div className="mt-5 border-t border-line pt-4">
            {prices.length === 0 ? (
              <EmptyState title="No overrides">All costs use the bundled list prices.</EmptyState>
            ) : (
              <>
                <ul className="space-y-3 lg:hidden">
                  {prices.map((p) => (
                    <li key={p.id} className="rounded-lg border border-line p-3 text-sm">
                      <p className="font-medium">
                        {p.model} <span className="font-normal text-ink-3">{p.provider}</span>
                      </p>
                      <p className="num text-[13px] text-ink-2">
                        In {rate(p.inputPerMTok)}, out {rate(p.outputPerMTok)}, cache read {rate(p.cacheReadPerMTok)}, cache write{" "}
                        {rate(p.cacheWritePerMTok)}
                      </p>
                      <p className="text-[12px] text-ink-3">
                        {p.orgId ? "This agency" : "Server-wide"}, from {p.effectiveFrom.toISOString().slice(0, 10)}
                        {p.note ? `. ${p.note}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="-mx-5 hidden lg:block">
                  <table className="dtable">
                    <thead>
                      <tr>
                        <th className="pl-5">Model</th>
                        <th>Provider</th>
                        <th>Applies to</th>
                        <th className="r">Input</th>
                        <th className="r">Output</th>
                        <th className="r">Cache read</th>
                        <th className="r">Cache write</th>
                        <th>From</th>
                        <th className="pr-5">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map((p) => (
                        <tr key={p.id}>
                          <td className="pl-5 font-medium">{p.model}</td>
                          <td>{p.provider}</td>
                          <td>{p.orgId ? "This agency" : "Server-wide"}</td>
                          <td className="r">{rate(p.inputPerMTok)}</td>
                          <td className="r">{rate(p.outputPerMTok)}</td>
                          <td className="r">{rate(p.cacheReadPerMTok)}</td>
                          <td className="r">{rate(p.cacheWritePerMTok)}</td>
                          <td className="num">{p.effectiveFrom.toISOString().slice(0, 10)}</td>
                          <td className="pr-5 text-ink-2">{p.note ?? "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </Panel>
      </section>
    </div>
  );
}
