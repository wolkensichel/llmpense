import { ingestBatchSchema, type UsageEventInput } from "@llmpense/core";

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

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** POST /api/v1/events. Pure apart from `deps`, so validation is testable without a database. */
export async function handleIngest(req: Request, deps: IngestDeps): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(lpk_[A-Za-z0-9_-]+)\s*$/.exec(auth);
  if (!m) return json({ error: "Missing or malformed Authorization header. Use: Bearer lpk_..." }, 401);

  const key = await deps.findKey(deps.hash(m[1]!));
  if (!key) return json({ error: "Unknown or revoked API key" }, 401);

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
