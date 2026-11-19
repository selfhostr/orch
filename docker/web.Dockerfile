# orch web image: the Vite build served as static files by Caddy (production).
# Build context = repository root:
#   docker build -f docker/web.Dockerfile -t orch-web .
# The Caddyfile is mounted by deploy/server/compose.yaml; a copy is baked in as a fallback.

# Base images are pinned by digest (tag kept readable); Dependabot bumps both together.
FROM node:26-bookworm-slim@sha256:5df79989ed685e09f0a98019db4cebfb22fb9df1a53c0161664a011f7ff6b0f1 AS build
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
RUN corepack enable && corepack prepare pnpm@12.14.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@orch/web..."
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/
RUN pnpm --filter @orch/web build

FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY --from=build /repo/apps/web/dist /srv
COPY deploy/server/Caddyfile.acme /etc/caddy/Caddyfile
COPY deploy/server/routes.caddy /etc/caddy/routes.caddy
COPY deploy/server/upstream.caddy /etc/caddy/upstream.caddy
