import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load the repo-root .env (DATABASE_URL) for the integration test, if present.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env: the DB-backed tests are skipped unless DATABASE_URL is set otherwise.
}

export default defineConfig({
  test: {
    env: process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {},
    testTimeout: 20_000,
  },
});
