import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load the repo-root .env (DATABASE_URL) for the DB-backed tests, if present.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env: the DB-backed tests are skipped unless DATABASE_URL is set otherwise.
}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    env: process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {},
    testTimeout: 20_000,
  },
});
