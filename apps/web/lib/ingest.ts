import { HEADERS, ingestBatchSchema, type UsageEventInput } from "@llmpense/core";

export interface IngestKey {
  id: string;
  orgId: string;
  defaultClientId: string | null;
  defaultProjectId: string | null;
}

export interface IngestDeps {
  /** Looks up a non-revoked key by the sha256 hex of the presented token. */
  findKey(hash: string): Promise<IngestKey | null | undefined>;
  hash(token: string): string;
  record(key: IngestKey, events: UsageEventInput[]): Promise<{ inserted: number }>;
}

export const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TOKEN = /^lpk_[A-Za-z0-9_-]+$/;
const BEARER = /^Bearer\s+(lpk_[A-Za-z0-9_-]+)\s*$/;

export interface AuthOptions {
  /** Also accept the key as `x-llmpense-key`. */
  keyHeader?: boolean;
  /** Also accept the key as a `?key=` query parameter, for senders that can only configure a URL. */
  queryKey?: boolean;
}

/** Extracts an `lpk_` key from the request, or null when none is present in an accepted place. */
export function presentedKey(req: Request, opts: AuthOptions = {}): string | null {
  const m = BEARER.exec(req.headers.get("authorization") ?? "");
  if (m) return m[1]!;
  if (opts.keyHeader) {
    const h = req.headers.get(HEADERS.key)?.trim();
    if (h && TOKEN.test(h)) return h;
  }
  if (opts.queryKey) {
    const q = new URL(req.url).searchParams.get("key")?.trim();
    if (q && TOKEN.test(q)) return q;
  }
  return null;
}

/** Resolves the request's API key, or returns the 401 response to send. */
export async function authenticate(
  req: Request,
  deps: Pick<IngestDeps, "findKey" | "hash">,
  opts: AuthOptions = {},
): Promise<IngestKey | Response> {
  const token = presentedKey(req, opts);
  if (!token) {
    const where = ["Authorization: Bearer lpk_..."];
    if (opts.keyHeader) where.push(`${HEADERS.key}: lpk_...`);
    if (opts.queryKey) where.push("?key=lpk_...");
    return json({ error: `Missing or malformed API key. Use ${where.join(" or ")}` }, 401);
  }
  const key = await deps.findKey(deps.hash(token));
  if (!key) return json({ error: "Unknown or revoked API key" }, 401);
  return key;
}

/** POST /api/v1/events. Pure apart from `deps`, so validation is testable without a database. */
export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (!BEARER.test(auth)) return json({ error: "Missing or malformed Authorization header. Use: Bearer lpk_..." }, 401);
  const key = await authenticate(req, deps);
  if (key instanceof Response) return key;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const parsed = ingestBatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid events", issues: parsed.error.issues }, 400);

  const { inserted } = await deps.record(key, parsed.data.events);
  return json({ inserted }, 200);
}
