# LLMpense web app. Build from the repo root:
#   docker build -f apps/web/Dockerfile -t llmpense-web .
# Run with DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET (and optionally PROXY_PUBLIC_URL).

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @llmpense/web...
COPY packages ./packages
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @llmpense/web build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S llmpense && adduser -S llmpense -G llmpense
# Standalone output mirrors the monorepo layout; server.js lives in apps/web.
COPY --from=build --chown=llmpense:llmpense /repo/apps/web/.next/standalone ./
COPY --from=build --chown=llmpense:llmpense /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=llmpense:llmpense /repo/apps/web/public ./apps/web/public
USER llmpense
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
