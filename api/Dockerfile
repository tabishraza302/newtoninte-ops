# syntax=docker/dockerfile:1

# Build context is the repository root (see docker-compose.yml) because this is
# a Bun workspace: the lockfile and tsconfig.base.json live at the root.
FROM oven/bun:1-alpine

WORKDIR /app

# Manifests + lockfile first so dependency installation is cached independently
# of source changes. All workspace manifests are required for a frozen install.
COPY package.json bun.lock tsconfig.base.json ./
COPY api/package.json ./api/package.json
COPY web/package.json ./web/package.json

RUN bun install --frozen-lockfile

# Application source.
COPY api ./api

# Drop privileges: the base image ships an unprivileged `bun` user.
USER bun

WORKDIR /app/api

EXPOSE 3000

CMD ["bun", "run", "start"]
