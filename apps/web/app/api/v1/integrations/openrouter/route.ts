import { getDb } from "@/lib/db.ts";
import { dbIngestDeps } from "@/lib/ingest-db.ts";
import { handleIntegration } from "@/lib/integrations/handler.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleIntegration(req, "openrouter", dbIngestDeps(getDb()));
}

/** The OpenRouter webhook destination can be set to send PUT instead of POST. */
export const PUT = POST;
