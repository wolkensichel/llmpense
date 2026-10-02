import "server-only";
import { cookies } from "next/headers";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "./session.ts";
import { getCurrentOrg } from "./org.ts";

/** Server actions and route handlers re-check the session; the proxy alone is not the gate. */
export async function requireAdmin() {
  if (!authEnabled()) return getCurrentOrg();
  const jar = await cookies();
  if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value))) throw new Error("Not signed in");
  return getCurrentOrg();
}
