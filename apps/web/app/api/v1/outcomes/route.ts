import { getDb } from "@/lib/db.ts";
import { dbOutcomeDeps } from "@/lib/ingest-db.ts";
import { handleOutcomes } from "@/lib/outcomes.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleOutcomes(req, dbOutcomeDeps(getDb()));
}
