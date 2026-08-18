# Single service: apps/web is the whole app (Next.js pages + /api/* routes).
# Built from the monorepo root so pnpm workspaces (packages/db) resolve.
#
# Skips Next's `output: standalone` file-tracing on purpose — this is a pnpm
# monorepo with Prisma's native query-engine binary loaded dynamically (not
# via static import), which Next's tracer is known to drop from a standalone
# bundle. Shipping the full node_modules from the build stage costs image
# size but removes an entire class of "works locally, missing file in prod"
# failures for very little that actually matters on Railway.

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
# openssl — Prisma's Linux query-engine binary dynamically links libssl;
# bookworm-slim doesn't ship it by default.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/db/package.json ./packages/db/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter db exec prisma generate
RUN pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
# ffmpeg/ffprobe — shelled out to directly (see apps/web/src/lib/ffmpeg.ts),
# not an npm package, so it has to be an OS package in the runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
WORKDIR /app/apps/web

EXPOSE 3002
# Applies any pending migrations against DATABASE_URL before serving — the
# prod DB starts with no tables at all, so skipping this makes the very
# first request 500. Safe to run on every restart (`migrate deploy` is a
# no-op once everything's applied); a second concurrent instance racing this
# would need something more careful, but that's not this deploy's shape.
CMD ["sh", "-c", "pnpm --filter db exec prisma migrate deploy && pnpm start"]
