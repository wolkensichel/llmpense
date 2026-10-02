import { BellRing, Check } from "lucide-react";
import { acknowledgeAlert } from "@/app/(app)/budgets/actions.ts";
import { dateTime, usd } from "@/lib/format.ts";

export interface AlertItem {
  id: string;
  threshold: number;
  periodStart: string;
  spendUsd: string;
  acknowledgedAt: Date | null;
  createdAt: Date;
  scope: "org" | "client" | "project";
  amountUsd: string;
  clientName: string | null;
  projectName: string | null;
}

function scopeName(a: AlertItem) {
  if (a.scope === "org") return "Whole agency";
  if (a.scope === "client") return a.clientName ?? "Deleted client";
  return `${a.clientName ? `${a.clientName} / ` : ""}${a.projectName ?? "Deleted project"}`;
}

function monthName(periodStart: string) {
  return new Date(`${periodStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function AlertList({ items }: { items: AlertItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const over = a.threshold >= 100;
        return (
          <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
                a.acknowledgedAt ? "bg-surface-2 text-ink-3" : over ? "bg-loss-soft text-loss-ink" : "bg-accent-soft text-accent"
              }`}
              aria-hidden
            >
              <BellRing size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-5">
                <span className="font-medium">{scopeName(a)}</span>{" "}
                {over ? "went over its budget" : `passed ${a.threshold}% of its budget`} in {monthName(a.periodStart)}
              </p>
              <p className="num mt-0.5 text-[13px] text-ink-3">
                {usd(Number(a.spendUsd))} of {usd(Number(a.amountUsd))}, flagged {dateTime(a.createdAt)} UTC
              </p>
            </div>
            {a.acknowledgedAt ? (
              <span className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3">
                <Check size={14} aria-hidden /> Seen
              </span>
            ) : (
              <form action={acknowledgeAlert}>
                <input type="hidden" name="id" value={a.id} />
                <button className="btn btn-quiet min-h-11 px-3 text-[13px]">Acknowledge</button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
