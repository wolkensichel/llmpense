import "server-only";
import { cache } from "react";
import { asc } from "drizzle-orm";
import { orgs } from "@llmpense/db";
import { getDb } from "./db.ts";

export type Org = typeof orgs.$inferSelect;

/**
 * The org the current request acts on. Self-hosted installs have exactly one, so this
 * takes the oldest org (creating one on a fresh install).
 */
export const getCurrentOrg = cache(async (): Promise<Org> => {
  const db = getDb();
  const [first] = await db.select().from(orgs).orderBy(asc(orgs.createdAt)).limit(1);
  if (first) return first;
  const [created] = await db
    .insert(orgs)
    .values({ name: "My agency", slug: "default" })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db.select().from(orgs).orderBy(asc(orgs.createdAt)).limit(1);
  return again!;
});
