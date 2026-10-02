import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, hashApiKey, recordEvents } from "@llmpense/db";
import { getDb } from "@/lib/db.ts";
import { handleIngest } from "@/lib/ingest.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const db = getDb();
  return handleIngest(req, {
    hash: hashApiKey,
    async findKey(hash) {
      const [k] = await db
        .select({
          id: apiKeys.id,
          orgId: apiKeys.orgId,
          defaultClientId: apiKeys.defaultClientId,
          defaultProjectId: apiKeys.defaultProjectId,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
        .limit(1);
      if (k) await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
      return k;
    },
    record(key, events) {
      return recordEvents(
        db,
        {
          orgId: key.orgId,
          source: "ingest",
          apiKeyId: key.id,
          defaultClientId: key.defaultClientId,
          defaultProjectId: key.defaultProjectId,
        },
        events,
      );
    },
  });
}
