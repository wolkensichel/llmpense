import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = sp.error === "1";
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <div className="mb-8 flex items-center gap-3">
        <img src="/icon.svg" alt="" width={40} height={40} className="rounded-[10px]" />
        <span className="text-xl font-semibold tracking-tight">LLMpense</span>
      </div>
      <h1 className="text-[26px] leading-tight font-semibold tracking-tight">What your AI work earns, per client.</h1>
      <p className="mt-2 text-ink-2">Sign in with the admin password set in your server's environment.</p>
      <form method="post" action="/login/submit" className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Admin password</span>
          <input
            className="field"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </label>
        {error && (
          <p id="login-error" role="alert" className="text-sm text-loss-ink">
            That password is not correct.
          </p>
        )}
        <button className="btn btn-primary w-full">Sign in</button>
      </form>
    </main>
  );
}
