import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="mt-1 text-ink-2">That page or client doesn't exist, or it was archived.</p>
      <Link href="/" className="btn btn-quiet mt-5 self-start">
        Go to overview
      </Link>
    </main>
  );
}
