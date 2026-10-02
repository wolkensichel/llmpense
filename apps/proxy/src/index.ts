import { serve } from "@hono/node-server";
import { createDb, recordEvents } from "@llmpense/db";
import { createApp } from "./app.ts";
import { EventBatcher } from "./batcher.ts";
import { loadConfig } from "./config.ts";
import { DbKeyResolver, log } from "./keys.ts";

const config = loadConfig();
const db = createDb();
const batcher = new EventBatcher((ctx, events) => recordEvents(db, ctx, events));
const app = createApp({ config, keys: new DbKeyResolver(db), recorder: batcher });

const server = serve({ fetch: app.fetch, port: config.port }, (info) =>
  log("info", "llmpense proxy listening", { port: info.port, upstreams: config.upstreams }),
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutting down", { signal });
  // Stop accepting connections; in-flight streams finish and enqueue their events.
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  await Promise.race([closed, new Promise((r) => setTimeout(r, 10_000).unref())]);
  await batcher.flush();
  await db.$client.end({ timeout: 5 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
