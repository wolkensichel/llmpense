import { getDb } from "@/lib/db.ts";
import { handleIngest } from "@/lib/ingest.ts";
import { dbIngestDeps } from "@/lib/ingest-db.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleIngest(req, dbIngestDeps(getDb()));
}
