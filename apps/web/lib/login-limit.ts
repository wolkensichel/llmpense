/** Failed sign-ins allowed per client address within the window. */
const CLIENT_LIMIT = 5;
/** Failed sign-ins allowed from all addresses together; forwarded addresses can be forged. */
const TOTAL_LIMIT = 30;
export const LOGIN_WINDOW_MS = 15 * 60_000;

/**
 * In-memory count of failed sign-ins for one server process. Sign-in is refused for everyone over
 * the limit, also with the right password; signed-in sessions keep working.
 */
export function createLoginLimiter() {
  let failures: { at: number; client: string }[] = [];
  const recent = (now: number) => (failures = failures.filter((f) => now - f.at < LOGIN_WINDOW_MS));
  return {
    blocked(client: string, now = Date.now()) {
      const all = recent(now);
      return all.length >= TOTAL_LIMIT || all.filter((f) => f.client === client).length >= CLIENT_LIMIT;
    },
    fail(client: string, now = Date.now()) {
      recent(now).push({ at: now, client });
    },
    succeed(client: string) {
      failures = failures.filter((f) => f.client !== client);
    },
  };
}

const g = globalThis as unknown as { __llmpenseLogin?: ReturnType<typeof createLoginLimiter> };
export const loginLimiter = (g.__llmpenseLogin ??= createLoginLimiter());

/** The address a reverse proxy reports, else one shared bucket. */
export function clientOf(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "direct";
}
