import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, hashApiKey, recordEvents, type Db } from "@llmpense/db";
import type { IngestDeps } from "./ingest.ts";

/** Database-backed key lookup and event recording shared by the ingest and integration endpoints. */
export function dbIngestDeps(db: Db): IngestDeps {
  return {
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
  };
}
