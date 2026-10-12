import "server-only";
import { headers } from "next/headers";

/** Where SDKs reach the proxy: PROXY_PUBLIC_URL, else localhost on PROXY_PORT. */
export function proxyBase(): string {
  const raw = (process.env.PROXY_PUBLIC_URL ?? `localhost:${process.env.PROXY_PORT ?? 8787}`).replace(/\/+$/, "");
  return /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
}

/** Where the dashboard and its APIs are reached: APP_PUBLIC_URL, else the request's host. */
export async function appBase(): Promise<string> {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0]!.trim();
  return `${proto}://${host}`;
}
