# Build from the repo root: docker build -f apps/proxy/Dockerfile -t llmpense-proxy .
FROM node:22-alpine

WORKDIR /app
RUN corepack enable

# Manifests first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/proxy/package.json apps/proxy/
RUN pnpm install --frozen-lockfile --prod --filter "@llmpense/proxy..."

COPY packages/core packages/core
COPY packages/db packages/db
COPY apps/proxy/src apps/proxy/src
COPY apps/proxy/tsconfig.json apps/proxy/

ENV NODE_ENV=production \
    PROXY_PORT=8787
EXPOSE 8787
USER node
WORKDIR /app/apps/proxy
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PROXY_PORT}/healthz || exit 1
# Runs TypeScript directly with tsx; DATABASE_URL and *_BASE_URL come from the environment.
CMD ["node_modules/.bin/tsx", "src/index.ts"]
