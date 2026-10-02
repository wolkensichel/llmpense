"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h1 className="text-lg font-semibold">This page couldn't load its numbers</h1>
      <p className="mt-1 text-sm text-ink-2">
        Check that the database is reachable, then try again.{error.digest ? ` Reference ${error.digest}.` : ""}
      </p>
      <button onClick={reset} className="btn btn-quiet mt-4">
        Try again
      </button>
    </div>
  );
}
