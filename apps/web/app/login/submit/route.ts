import { NextResponse } from "next/server";
import { checkPassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/session.ts";

export const dynamic = "force-dynamic";

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : "/";
}

/** Plain form POST so sign-in works without JavaScript and from curl. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next") ?? null);
  const origin = new URL(req.url);

  if (!form || !(await checkPassword(String(form.get("password") ?? "")))) {
    await new Promise((r) => setTimeout(r, 400));
    const back = new URL("/login", origin);
    back.searchParams.set("error", "1");
    if (next !== "/") back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }

  const res = NextResponse.redirect(new URL(next, origin), 303);
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
