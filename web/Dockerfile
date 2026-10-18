# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — install the workspace and produce the static SPA bundle.
# Build context is the repository root (see docker-compose.yml): the lockfile
# and tsconfig.base.json live there and are needed for a frozen install.
# ---------------------------------------------------------------------------
FROM oven/bun:1-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json

RUN bun install --frozen-lockfile

COPY web ./web

RUN bun run --cwd web build

# ---------------------------------------------------------------------------
# Runtime stage — static files served by nginx, which also proxies the API so
# the browser sees a single origin.
# ---------------------------------------------------------------------------
FROM nginx:alpine

COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
