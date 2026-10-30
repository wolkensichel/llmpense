import { NextResponse } from "next/server";
import { clientOf, loginLimiter } from "@/lib/login-limit.ts";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

/** Relative, so it keeps the public host behind a reverse proxy; `req.url` has the internal one. */
const seeOther = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

/** Plain form POST so sign-in works without JavaScript and from curl. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next") ?? null);
  const origin = new URL(req.url);
  const client = clientOf(req.headers);
  const refuse = (error: string) => {
    const q = new URLSearchParams({ error });
    if (next !== "/") q.set("next", next);
    return seeOther(`/login?${q}`);
  };

  if (loginLimiter.blocked(client)) return refuse("2");
  if (!form || !(await checkPassword(String(form.get("password") ?? "")))) {
    loginLimiter.fail(client);
    await new Promise((r) => setTimeout(r, 400));
    return refuse("1");
  }
  loginLimiter.succeed(client);

  const res = seeOther(next);
  const proto = (req.headers.get("x-forwarded-proto") ?? origin.protocol.replace(":", "")).split(",")[0]!.trim();
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: proto === "https",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
