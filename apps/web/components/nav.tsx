"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Bell, ChartNoAxesColumn, Rows3, Settings2, UsersRound } from "lucide-react";
import { RANGE_KEYS, RANGE_LABELS, type RangeKey } from "@/lib/range.ts";

const ITEMS = [
  { href: "/", label: "Overview", icon: ChartNoAxesColumn },
  { href: "/clients", label: "Clients", icon: UsersRound },
  { href: "/events", label: "Events", icon: Rows3 },
  { href: "/budgets", label: "Budgets", icon: Bell },
  { href: "/settings", label: "Settings", icon: Settings2 },
] as const;

/** Pages whose numbers do not depend on the global range. */
const RANGELESS = ["/budgets", "/settings"];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function useRangeQuery() {
  const range = useSearchParams().get("range");
  return range && (RANGE_KEYS as readonly string[]).includes(range) ? `?range=${range}` : "";
}

export function SideNav({ alertCount }: { alertCount: number }) {
  const pathname = usePathname();
  const q = useRangeQuery();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={`${href}${q}`}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] ${
              active ? "bg-surface font-medium text-ink shadow-[inset_0_0_0_1px_var(--line)]" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon size={18} strokeWidth={1.75} aria-hidden className={active ? "text-accent" : undefined} />
            <span className="flex-1">{label}</span>
            {href === "/budgets" && alertCount > 0 && (
              <span className="num rounded-full bg-loss px-1.5 text-xs leading-5 font-medium text-white" aria-label={`${alertCount} open alerts`}>
                {alertCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomTabs({ alertCount }: { alertCount: number }) {
  const pathname = usePathname();
  const q = useRangeQuery();
  return (
    <nav
      aria-label="Main"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={`${href}${q}`}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? "font-medium text-accent" : "text-ink-3"
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2 : 1.6} aria-hidden />
                {label}
                {href === "/budgets" && alertCount > 0 && (
                  <span className="absolute top-1.5 left-[calc(50%+6px)] size-2 rounded-full bg-loss" aria-label={`${alertCount} open alerts`} />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function RangePicker() {
  const pathname = usePathname();
  const params = useSearchParams();
  if (RANGELESS.some((p) => isActive(pathname, p))) return null;
  const current = (params.get("range") as RangeKey | null) ?? "30d";
  return (
    <nav aria-label="Date range" className="w-full lg:w-auto">
      <ul className="grid grid-cols-5 rounded-lg border border-line bg-surface p-0.5 lg:flex">
        {RANGE_KEYS.map((k) => {
          const next = new URLSearchParams(params);
          next.set("range", k);
          next.delete("cursor");
          const active = k === current;
          return (
            <li key={k}>
              <Link
                href={`${pathname}?${next.toString()}`}
                aria-current={active ? "true" : undefined}
                title={RANGE_LABELS[k].long}
                className={`flex min-h-10 items-center justify-center rounded-md px-3 text-sm whitespace-nowrap ${
                  active ? "bg-accent font-medium text-on-accent" : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                {RANGE_LABELS[k].short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
