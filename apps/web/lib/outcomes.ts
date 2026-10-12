import { outcomesBatchSchema, type OutcomeInput } from "@llmpense/core";
import { authenticate, json, type IngestDeps, type IngestKey } from "./ingest.ts";

export interface OutcomeDeps extends Pick<IngestDeps, "findKey" | "hash"> {
  /** Upserts outcomes for the key's org; returns how many distinct (runId, name) pairs were written. */
  upsert(key: IngestKey, outcomes: OutcomeInput[]): Promise<number>;
}

/** POST /api/v1/outcomes. Pure apart from `deps`, so validation is testable without a database. */
export async function handleOutcomes(req: Request, deps: OutcomeDeps): Promise<Response> {
  const key = await authenticate(req, deps);
  if (key instanceof Response) return key;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const parsed = outcomesBatchSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid outcomes", issues: parsed.error.issues }, 400);

  const upserted = await deps.upsert(key, parsed.data.outcomes);
  return json({ received: parsed.data.outcomes.length, upserted }, 200);
}
