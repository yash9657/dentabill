# Multi-stage Dockerfile for the DentaBill call worker (Phase 5 demo).
#
# The worker consumes the BullMQ call queue and drives Retell. With
# RETELL_API_KEY empty and DEMO_AUTOPILOT=true it runs FakeRetell under the
# autopilot driver, so an enqueued job completes a full scripted call instead
# of hanging to the duration cap.
#
# tsx-in-production is deliberate and pre-existing: `start` is already
# `tsx src/bin.ts` because every workspace package ships TypeScript sources
# (`"main": "./src/index.ts"`, no JS-emitting build). Compiling the workspace
# is a post-demo item — see apps/api/Dockerfile for the full rationale.
#
# The runtime stage copies the whole built tree because pnpm places the
# generated Prisma client under a content-hashed .pnpm path that cannot be
# hardcoded in a COPY.

# ─── Stage 1: dependencies + generated client ────────────────────────────────
FROM node:20-slim AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable pnpm && corepack prepare pnpm@10.33.0 --activate

WORKDIR /build

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

RUN pnpm fetch --frozen-lockfile

COPY . .

RUN pnpm install --frozen-lockfile --offline

RUN pnpm --filter @dentabill/db exec prisma generate

RUN test -n "$(find node_modules/.pnpm -path '*/.prisma/client/index.js' | head -1)" \
  || (echo 'Prisma client was not generated' && exit 1)

# pnpm scopes package bins per workspace member, so tsx is NOT at the root
# node_modules/.bin. Assert the exact path CMD uses — otherwise the image
# builds happily and then dies on startup with "No such file or directory".
RUN test -x apps/call-worker/node_modules/.bin/tsx \
  || (echo 'tsx binary missing at apps/call-worker/node_modules/.bin/tsx' && exit 1)

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
ENV HEALTH_PORT=3010

EXPOSE 3010

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3010/healthz',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["apps/call-worker/node_modules/.bin/tsx", "apps/call-worker/src/bin.ts"]
