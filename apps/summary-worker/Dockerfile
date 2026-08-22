# Multi-stage Dockerfile for the DentaBill summary worker (Phase 5 demo).
#
# The worker consumes completed calls and produces a CallSummary via the
# summarizer adapter — LiveClaude when ANTHROPIC_API_KEY is set, FakeClaude
# otherwise. With SUMMARIZER_AUTO_TRANSITION_ENABLED=true it also transitions
# the claim and writes the decision (summaryId + confidence + promptVersion)
# to the audit log.
#
# tsx-in-production is deliberate and pre-existing: `start` is already
# `tsx src/bin.ts` because every workspace package ships TypeScript sources.
# See apps/api/Dockerfile for the full rationale.

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
RUN test -x apps/summary-worker/node_modules/.bin/tsx \
  || (echo 'tsx binary missing at apps/summary-worker/node_modules/.bin/tsx' && exit 1)

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
ENV WORKER_PORT=3011

EXPOSE 3011

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3011/healthz',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]

CMD ["apps/summary-worker/node_modules/.bin/tsx", "apps/summary-worker/src/bin.ts"]
