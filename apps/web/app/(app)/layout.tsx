import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { and, count, eq, isNull } from "drizzle-orm";
import { alerts } from "@llmpense/db";
import { getDb } from "@/lib/db.ts";
import { getCurrentOrg } from "@/lib/org.ts";
import { BottomTabs, RangePicker, SideNav } from "@/components/nav.tsx";
import { ThemeToggle } from "@/components/theme-toggle.tsx";
import { logout } from "../login/actions.ts";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const org = await getCurrentOrg();
  const [row] = await getDb()
    .select({ n: count() })
    .from(alerts)
    .where(and(eq(alerts.orgId, org.id), isNull(alerts.acknowledgedAt)));
  const alertCount = row?.n ?? 0;

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <img src="/icon.svg" alt="" width={26} height={26} className="rounded-[7px]" />
          <span className="text-[17px] font-semibold tracking-tight">LLMpense</span>
        </div>
        <Suspense>
          <SideNav alertCount={alertCount} />
        </Suspense>
        <div className="mt-auto border-t border-line px-1 pt-3">
          <p className="truncate px-2 text-sm font-medium">{org.name}</p>
          <div className="mt-1 flex items-center">
            <ThemeToggle />
            <form action={logout}>
              <button className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
                <LogOut size={16} strokeWidth={1.75} aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="min-w-0 pb-24 lg:pb-10">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur lg:static lg:border-0 lg:bg-transparent lg:backdrop-blur-none">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-2 px-4 pt-2 pb-3 lg:flex-row lg:items-center lg:justify-end lg:px-8 lg:pt-6 lg:pb-0">
            <div className="flex items-center justify-between lg:hidden">
              <div className="flex items-center gap-2">
                <img src="/icon.svg" alt="" width={24} height={24} className="rounded-[6px]" />
                <span className="font-semibold tracking-tight">LLMpense</span>
              </div>
              <div className="flex items-center">
                <ThemeToggle />
                <form action={logout}>
                  <button aria-label="Sign out" className="inline-flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2">
                    <LogOut size={18} strokeWidth={1.75} aria-hidden />
                  </button>
                </form>
              </div>
            </div>
            <Suspense>
              <RangePicker />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto max-w-[1240px] px-4 pt-4 lg:px-8 lg:pt-2">{children}</main>
      </div>

      <Suspense>
        <BottomTabs alertCount={alertCount} />
      </Suspense>
    </div>
  );
}
