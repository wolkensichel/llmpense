import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, hashApiKey, recordEvents, upsertOutcomes, type Db } from "@llmpense/db";
import type { IngestDeps } from "./ingest.ts";
import type { OutcomeDeps } from "./outcomes.ts";

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

/** Database-backed key lookup and outcome upserts for the outcomes endpoint. */
export function dbOutcomeDeps(db: Db): OutcomeDeps {
  const { hash, findKey } = dbIngestDeps(db);
  return { hash, findKey, upsert: (key, outcomes) => upsertOutcomes(db, key.orgId, outcomes) };
}
