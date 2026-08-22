# Multi-stage Dockerfile for the DentaBill Fastify API (Phase 5 demo).
#
# Two deliberate deviations from GOLIVE_PLAN §G-E2, both forced by how this
# workspace is actually wired:
#
#   1. The entrypoint is `tsx apps/api/src/server.ts`, not `node dist/server.js`.
#      Every workspace package declares `"main": "./src/index.ts"` and has no
#      build step that emits JavaScript (see packages/*/package.json — `build`
#      is `echo 'no build …'` for all of them). So even a fully compiled
#      apps/api/dist would import `@dentabill/db` and resolve it to TypeScript,
#      which node cannot load. Shipping compiled output requires adding real
#      tsc emit to seven packages — a refactor, not a Dockerfile change. The
#      plan already accepted tsx-in-production for the two workers; this
#      extends the same accepted tradeoff to the api. Post-demo item.
#
#   2. The runtime stage copies the whole built tree rather than cherry-picking
#      node_modules subdirectories. Under pnpm the generated Prisma client
#      lives at node_modules/.pnpm/@prisma+client@<version>_<hash>/node_modules/
#      .prisma/client — a path containing a content hash that cannot be
#      hardcoded in a COPY. Copying the tree wholesale keeps pnpm's relative
#      symlink graph intact and carries .prisma with it. Costs image size;
#      buys a build that works.
#
# Prisma migrations (`prisma migrate deploy`) run as a separate release step,
# never in the container CMD.

# ─── Stage 1: dependencies + generated client ────────────────────────────────
FROM node:20-slim AS deps

# Prisma's query engine needs OpenSSL and CA certs on the slim (Debian) base.
# Without these the client builds fine and then fails at first connect.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm && corepack prepare pnpm@10.33.0 --activate

WORKDIR /build

# Manifests first so the dependency layer survives source-only changes.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Warm the offline store from the lockfile alone.
RUN pnpm fetch --frozen-lockfile

# Full workspace: `pnpm install` needs every member's package.json, and the
# runtime needs the TypeScript sources themselves (see note 1 above).
# node_modules is excluded by .dockerignore, so no host-built (darwin) Prisma
# engine can leak into the image.
COPY . .

RUN pnpm install --frozen-lockfile --offline

# Generate the client INSIDE the image so the engine matches this platform.
RUN pnpm --filter @dentabill/db exec prisma generate

# Fail the build rather than at runtime if generation landed nowhere.
RUN test -n "$(find node_modules/.pnpm -path '*/.prisma/client/index.js' | head -1)" \
  || (echo 'Prisma client was not generated' && exit 1)

# pnpm scopes package bins per workspace member, so tsx is NOT at the root
# node_modules/.bin. Assert the exact path CMD uses — otherwise the image
# builds happily and then dies on startup with "No such file or directory".
RUN test -x apps/api/node_modules/.bin/tsx \
  || (echo 'tsx binary missing at apps/api/node_modules/.bin/tsx' && exit 1)

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 appuser

WORKDIR /app

COPY --from=deps --chown=appuser:appuser /build ./

USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/v1/readyz',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["apps/api/node_modules/.bin/tsx", "apps/api/src/server.ts"]
