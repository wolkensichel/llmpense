import Link from "next/link";
import { BellRing, Check, TriangleAlert } from "lucide-react";
import { acknowledgeAlert } from "@/app/(app)/budgets/actions.ts";
import { dateTime, usd } from "@/lib/format.ts";

export interface AlertItem {
  id: string;
  kind: "budget" | "fixed_fee_loss";
  threshold: number | null;
  periodStart: string;
  spendUsd: string;
  feeUsd: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
  scope: "org" | "client" | "project" | null;
  amountUsd: string | null;
  clientId: string | null;
  clientName: string | null;
  projectName: string | null;
}

function monthName(periodStart: string) {
  return new Date(`${periodStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function ClientName({ a, fallback }: { a: AlertItem; fallback: string }) {
  const name = a.clientName ?? fallback;
  return a.clientId ? (
    <Link href={`/clients/${a.clientId}`} className="font-medium text-accent hover:underline">
      {name}
    </Link>
  ) : (
    <span className="font-medium">{name}</span>
  );
}

function BudgetText({ a }: { a: AlertItem }) {
  const threshold = a.threshold ?? 100;
  const over = threshold >= 100;
  const subject =
    a.scope === "org" ? (
      <span className="font-medium">Whole agency</span>
    ) : a.scope === "client" ? (
      <ClientName a={a} fallback="Deleted client" />
    ) : (
      <>
        {a.clientName && (
          <>
            <ClientName a={a} fallback="" /> /{" "}
          </>
        )}
        <span className="font-medium">{a.projectName ?? "Deleted project"}</span>
      </>
    );
  return (
    <>
      <p className="text-[14px] leading-5">
        {subject} {over ? "went over its budget" : `passed ${threshold}% of its budget`} in {monthName(a.periodStart)}
      </p>
      <p className="num mt-0.5 text-[13px] text-ink-3">
        {usd(Number(a.spendUsd))} of {usd(Number(a.amountUsd ?? 0))}, flagged {dateTime(a.createdAt)} UTC
      </p>
    </>
  );
}

function LossText({ a }: { a: AlertItem }) {
  return (
    <>
      <p className="text-[14px] leading-5">
        <ClientName a={a} fallback="Deleted client" /> cost more than its fixed fee in {monthName(a.periodStart)}
      </p>
      <p className="num mt-0.5 text-[13px] text-ink-3">
        Provider cost {usd(Number(a.spendUsd))} against {usd(Number(a.feeUsd ?? 0))} of fee earned so far, flagged {dateTime(a.createdAt)} UTC
      </p>
    </>
  );
}

export function AlertList({ items }: { items: AlertItem[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((a) => {
        const loss = a.kind === "fixed_fee_loss";
        const severe = loss || (a.threshold ?? 0) >= 100;
        const Icon = loss ? TriangleAlert : BellRing;
        return (
          <li key={a.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={`mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${
                a.acknowledgedAt ? "bg-surface-2 text-ink-3" : severe ? "bg-loss-soft text-loss-ink" : "bg-accent-soft text-accent"
              }`}
              aria-hidden
            >
              <Icon size={16} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">{loss ? <LossText a={a} /> : <BudgetText a={a} />}</div>
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
