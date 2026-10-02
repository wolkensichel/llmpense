import { ArrowDownRight, ArrowUpRight, Minus, TriangleAlert } from "lucide-react";
import type { BillingMode } from "@llmpense/core";
import { BILLING_LABELS, pct, usd } from "@/lib/format.ts";

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[24px] leading-8 font-semibold tracking-tight lg:text-[28px] lg:leading-9">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-ink-2">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Panel({
  title,
  sub,
  actions,
  children,
  className = "",
  flush = false,
}: {
  title?: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 lg:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? "pt-2" : "p-4 lg:px-5"}>{children}</div>
    </section>
  );
}

const SLOT_VAR = (slot: number) => `var(--s${slot})`;

export function ClientDot({ slot, className = "" }: { slot: number; className?: string }) {
  return <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-full ${className}`} style={{ background: SLOT_VAR(slot) }} />;
}

export function BillingBadge({ mode, markupPct, fixedFeeUsd }: { mode: BillingMode; markupPct?: number; fixedFeeUsd?: number }) {
  const detail =
    mode === "markup" && markupPct !== undefined
      ? ` +${markupPct}%`
      : mode === "fixed" && fixedFeeUsd !== undefined
        ? ` ${usd(fixedFeeUsd).replace(".00", "")}/mo`
        : "";
  return (
    <span className="inline-flex items-center rounded-md border border-line px-1.5 text-xs leading-5 whitespace-nowrap text-ink-2">
      {BILLING_LABELS[mode]}
      {detail}
    </span>
  );
}

/**
 * Change vs the previous period. `good` says which direction is favourable
 * ("up", "down" or "neutral"); the arrow and sign carry meaning, colour only reinforces it.
 */
export function Delta({
  value,
  good = "up",
  kind = "relative",
  className = "",
}: {
  value: number | null;
  good?: "up" | "down" | "neutral";
  kind?: "relative" | "points";
  className?: string;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className={`text-[13px] text-ink-3 ${className}`}>no prior data</span>;
  }
  const flat = Math.abs(value) < (kind === "points" ? 0.0005 : 0.0005);
  const up = value > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const favourable = good === "neutral" || flat ? null : (good === "up") === up;
  const tone = favourable === null ? "text-ink-2" : favourable ? "text-profit-ink" : "text-loss-ink";
  const text =
    kind === "points"
      ? `${up ? "+" : flat ? "" : "−"}${Math.abs(value * 100).toFixed(1)} pts`
      : `${up ? "+" : flat ? "" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[13px] font-medium ${tone} ${className}`}>
      <Icon size={14} strokeWidth={2} aria-hidden />
      <span className="num">{text}</span>
    </span>
  );
}

export function MarginValue({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`num ${value < 0 ? "text-loss-ink" : ""} ${className}`}>{usd(value)}</span>;
}

export function MarginPct({ value, className = "" }: { value: number | null; className?: string }) {
  return <span className={`num ${value !== null && value < 0 ? "text-loss-ink" : "text-ink-2"} ${className}`}>{pct(value)}</span>;
}

export function LossTag({ label = "Losing money" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-loss-soft px-1.5 text-xs leading-5 font-medium whitespace-nowrap text-loss-ink">
      <TriangleAlert size={12} strokeWidth={2.25} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Cost against revenue on a shared scale. The grey run is provider cost; past it, green is
 * margin kept, red is cost the client does not cover. Labels say the same in words.
 */
export function MarginBar({ cost, revenue, scale }: { cost: number; revenue: number; scale: number }) {
  const s = scale > 0 ? scale : 1;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / s) * 100))}%`;
  const covered = Math.min(cost, revenue);
  const kept = Math.max(0, revenue - cost);
  const lost = Math.max(0, cost - revenue);
  return (
    <div
      className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-[3px] bg-surface-2"
      role="img"
      aria-label={`Provider cost ${usd(cost)}, revenue ${usd(revenue)}`}
    >
      {covered > 0 && <span className="h-full shrink-0 rounded-l-[3px]" style={{ width: w(covered), background: "var(--cost-bar)" }} />}
      {kept > 0 && <span className="h-full shrink-0 rounded-r-[3px]" style={{ width: w(kept), background: "var(--profit)" }} />}
      {lost > 0 && <span className="h-full shrink-0 rounded-r-[3px]" style={{ width: w(lost), background: "var(--loss)" }} />}
    </div>
  );
}

export function MarginBarLegend() {
  const item = (color: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2 w-3 rounded-[2px]" style={{ background: color }} />
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
      {item("var(--cost-bar)", "Provider cost covered")}
      {item("var(--profit)", "Margin kept")}
      {item("var(--loss)", "Cost not covered")}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function FrozenNote() {
  return (
    <p className="text-[13px] text-ink-3">
      Billed amounts are frozen when each request is recorded, using the client's billing settings at that moment.
      Changing settings affects new usage only. Fixed fees count per calendar month and are prorated by day for partial months.
    </p>
  );
}
