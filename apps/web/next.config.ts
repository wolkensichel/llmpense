import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

// The monorepo keeps one `.env` at the root (DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET, DEV_ORIGINS).
// Variables already set in the environment win. Docker/standalone passes env directly.
try {
  process.loadEnvFile(`${root}.env`);
} catch {
  // no root .env; rely on the process environment
}

if (!process.env.ADMIN_PASSWORD) {
  console.warn("⚠ ADMIN_PASSWORD is empty: the dashboard opens without a login for anyone who can reach this server.");
}

const config: NextConfig = {
  output: "standalone",
  // Trace from the monorepo root so workspace packages land in the standalone output.
  outputFileTracingRoot: root,
  turbopack: { root },
  transpilePackages: ["@llmpense/core", "@llmpense/db"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  // Hosts other than localhost (e.g. a phone on the LAN) that may load dev-server assets.
  // Comma-separated in DEV_ORIGINS; without it, `next dev` only serves scripts to localhost.
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
  // `pnpm typecheck` (tsc 7) is the type gate; Next's built-in check expects the TS 5 JS API.
  typescript: { ignoreBuildErrors: true },
};

export default config;
