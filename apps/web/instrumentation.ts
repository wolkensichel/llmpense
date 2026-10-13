import { authWarnings } from "./lib/session.ts";

/** Runs once when the server starts (`next dev`, `next start` and the Docker image). */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  for (const warning of authWarnings()) console.warn(`⚠ ${warning}`);
}
