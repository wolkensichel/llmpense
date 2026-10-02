import { eq } from "drizzle-orm";
import { apiKeys, hashApiKey, type Db } from "@llmpense/db";

export interface KeyInfo {
  id: string;
  orgId: string;
  defaultClientId: string | null;
  defaultProjectId: string | null;
}

export interface KeyResolver {
  /** Resolves a raw `lpk_...` key to its record, or null if unknown or revoked. Throws if the DB is unreachable. */
  resolve(key: string): Promise<KeyInfo | null>;
}

export interface DbKeyResolverOptions {
  /** How long a positive lookup is cached. */
  ttlMs?: number;
  /** How long an unknown key is cached (short, so freshly created keys work quickly). */
  negativeTtlMs?: number;
  /** Minimum interval between last_used_at updates per key. */
  touchIntervalMs?: number;
  now?: () => number;
}

/** Looks keys up by sha256 hash, caches results and throttles last_used_at writes. */
export class DbKeyResolver implements KeyResolver {
  private cache = new Map<string, { at: number; info: KeyInfo | null }>();
  private inflight = new Map<string, Promise<KeyInfo | null>>();
  private touched = new Map<string, number>();
  private ttl: number;
  private negTtl: number;
  private touchInterval: number;
  private now: () => number;

  constructor(
    private db: Db,
    opts: DbKeyResolverOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 60_000;
    this.negTtl = opts.negativeTtlMs ?? 5_000;
    this.touchInterval = opts.touchIntervalMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  async resolve(key: string): Promise<KeyInfo | null> {
    const hash = hashApiKey(key);
    const hit = this.cache.get(hash);
    const now = this.now();
    let info: KeyInfo | null;
    if (hit && now - hit.at < (hit.info ? this.ttl : this.negTtl)) {
      info = hit.info;
    } else {
      let p = this.inflight.get(hash);
      if (!p) {
        p = this.lookup(hash).finally(() => this.inflight.delete(hash));
        this.inflight.set(hash, p);
      }
      info = await p;
      if (this.cache.size > 10_000) this.cache.clear();
      this.cache.set(hash, { at: this.now(), info });
    }
    if (info) this.touch(info.id);
    return info;
  }

  private async lookup(hash: string): Promise<KeyInfo | null> {
    const row = await this.db.query.apiKeys.findFirst({ where: eq(apiKeys.hash, hash) });
    if (!row || row.revokedAt) return null;
    return {
      id: row.id,
      orgId: row.orgId,
      defaultClientId: row.defaultClientId,
      defaultProjectId: row.defaultProjectId,
    };
  }

  private touch(id: string) {
    const now = this.now();
    const last = this.touched.get(id);
    if (last !== undefined && now - last < this.touchInterval) return;
    this.touched.set(id, now);
    this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date(now) })
      .where(eq(apiKeys.id, id))
      .catch((err: unknown) => log("warn", "last_used_at update failed", { error: String(err) }));
  }
}

export function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, ts: new Date().toISOString(), ...extra });
  if (level === "info") console.log(line);
  else console.error(line);
}
