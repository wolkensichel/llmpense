import { getDb } from "@/lib/db.ts";
import { dbIngestDeps } from "@/lib/ingest-db.ts";
import { handleIntegration } from "@/lib/integrations/handler.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleIntegration(req, "helicone", dbIngestDeps(getDb()));
}
