"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { KeyRound } from "lucide-react";
import { PROVIDERS } from "@llmpense/core";
import { CopyButton } from "@/components/copy-button.tsx";
import { addPrice, createApiKey } from "./actions.ts";

export function KeyForm({
  clients,
  projects,
}: {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string; clientName: string }[];
}) {
  const [state, action, pending] = useActionState(createApiKey, undefined);
  const [client, setClient] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.key) {
      ref.current?.reset();
      setClient("");
    }
  }, [state]);
  const visibleProjects = client ? projects.filter((p) => p.clientId === client) : projects;

  return (
    <div className="space-y-4">
      {state?.key && (
        <div role="status" className="rounded-lg border border-accent bg-accent-soft p-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRound size={16} aria-hidden /> Key for {state.name}. Copy it now; it won't be shown again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2.5 py-2.5 font-mono text-[13px]">{state.key}</code>
            <CopyButton text={state.key} />
          </div>
        </div>
      )}
      <form ref={ref} action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Name</span>
          <input name="name" required maxLength={100} className="field" placeholder="Production API server" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Default client</span>
          <select name="defaultClientId" className="field" value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">None (use headers)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Default project</span>
          <select name="defaultProjectId" className="field" defaultValue="">
            <option value="">None</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {client ? p.name : `${p.clientName} / ${p.name}`}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state?.error && (
        <p role="alert" className="text-sm text-loss-ink">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function PriceForm() {
  const [state, action, pending] = useActionState(addPrice, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Applies to</span>
          <select name="scope" className="field" defaultValue="org">
            <option value="org">This agency (negotiated rate)</option>
            <option value="global">Everyone on this server</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Provider</span>
          <select name="provider" className="field" defaultValue="openai">
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Model</span>
          <input name="model" required className="field" placeholder="gpt-5-mini" />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">USD per million tokens</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <RateInput name="inputPerMTok" label="Input" required />
          <RateInput name="outputPerMTok" label="Output" required />
          <RateInput name="cacheReadPerMTok" label="Cache read" />
          <RateInput name="cacheWritePerMTok" label="Cache write" />
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Effective from</span>
          <input name="effectiveFrom" type="date" required defaultValue={today} className="field num" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Note</span>
          <input name="note" maxLength={500} className="field" placeholder="Enterprise discount, contract 2026-Q4" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Add price"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
    </form>
  );
}

function RateInput({ name, label, required = false }: { name: string; label: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] text-ink-2">
        {label}
        {!required && <span className="text-ink-3"> (optional)</span>}
      </span>
      <input name={name} type="number" inputMode="decimal" min={0} step="any" required={required} className="field num" />
    </label>
  );
}
