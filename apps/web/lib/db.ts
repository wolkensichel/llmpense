import "server-only";
import { createDb, type Db } from "@llmpense/db";

const g = globalThis as unknown as { __llmpenseDb?: Db };

/** One pool per server process (survives dev hot reloads). */
export function getDb(): Db {
  g.__llmpenseDb ??= createDb();
  return g.__llmpenseDb;
}
