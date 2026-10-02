"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createBudget } from "./actions.ts";

export function BudgetForm({
  clients,
  projects,
}: {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientName: string }[];
}) {
  const [state, action, pending] = useActionState(createBudget, undefined);
  const [scope, setScope] = useState<"org" | "client" | "project">("client");
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={action} className="space-y-3">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">Applies to</legend>
        <div className="grid grid-cols-3 rounded-lg border border-line p-0.5">
          {(
            [
              ["org", "Agency"],
              ["client", "Client"],
              ["project", "Project"],
            ] as const
          ).map(([v, label]) => (
            <label
              key={v}
              className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md text-sm ${
                scope === v ? "bg-accent font-medium text-on-accent" : "text-ink-2 hover:bg-surface-2"
              }`}
            >
              <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {scope === "client" && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Client</span>
          <select name="clientId" className="field" required>
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {scope === "project" && (
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Project</span>
          <select name="projectId" className="field" required>
            <option value="">Choose a project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.clientName} / {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Monthly limit (USD)</span>
          <input name="amountUsd" type="number" inputMode="decimal" min="0.01" step="0.01" required className="field num" placeholder="250" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Alert at (%)</span>
          <input name="thresholds" defaultValue="50, 80, 100" required className="field num" />
        </label>
      </div>
      <p className="text-[13px] text-ink-3">Limits are on provider cost per calendar month (UTC), not on what the client is billed.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create budget"}
        </button>
        <p role="status" className={`text-sm ${state?.error ? "text-loss-ink" : "text-profit-ink"}`}>
          {state?.error ?? state?.ok}
        </p>
      </div>
    </form>
  );
}
