import type { UsageEventInput } from "@llmpense/core";
import type { RecordContext, RecordExtras } from "@llmpense/db";
import { log } from "./keys.ts";

export type ProxyEvent = UsageEventInput & RecordExtras;
export type RecordSink = (ctx: RecordContext, events: ProxyEvent[]) => Promise<unknown>;

export interface Recorder {
  add(ctx: RecordContext, event: ProxyEvent): void;
}

export interface BatcherOptions {
  intervalMs?: number;
  maxBatch?: number;
}

/**
 * Buffers events in memory and writes them off the request path. Flushes every
 * `intervalMs` or once `maxBatch` events are pending. Events are grouped per API key
 * because recordEvents takes one context per call. Failures are logged and dropped.
 */
export class EventBatcher implements Recorder {
  private pending = new Map<string, { ctx: RecordContext; events: ProxyEvent[] }>();
  private count = 0;
  private timer: NodeJS.Timeout | undefined;
  private chain: Promise<void> = Promise.resolve();
  private intervalMs: number;
  private maxBatch: number;

  constructor(
    private sink: RecordSink,
    opts: BatcherOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 1_000;
    this.maxBatch = opts.maxBatch ?? 100;
  }

  add(ctx: RecordContext, event: ProxyEvent) {
    const k = `${ctx.orgId}/${ctx.apiKeyId ?? ""}`;
    let group = this.pending.get(k);
    if (!group) {
      group = { ctx, events: [] };
      this.pending.set(k, group);
    }
    group.events.push(event);
    this.count++;
    if (this.count >= this.maxBatch) void this.flush();
    else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.intervalMs);
      this.timer.unref();
    }
  }

  /** Writes everything pending; resolves once all writes started so far are done. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const groups = [...this.pending.values()];
    this.pending.clear();
    this.count = 0;
    // Serialize writes so a slow DB never sees an unbounded number of parallel batches.
    this.chain = this.chain.then(async () => {
      for (const g of groups) {
        try {
          await this.sink(g.ctx, g.events);
        } catch (err) {
          log("error", "recording usage events failed", {
            orgId: g.ctx.orgId,
            dropped: g.events.length,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    });
    return this.chain;
  }
}
