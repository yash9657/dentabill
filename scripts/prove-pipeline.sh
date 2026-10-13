#!/usr/bin/env bash
# G-B6 — prove the demo pipeline end-to-end on localhost.
#
# Boots api + call-worker + summary-worker, enqueues a real call for a seeded
# claim, then polls Postgres for the downstream effects the demo depends on:
#   CallEvents written -> CallSummary produced -> Claim transitioned -> AuditLog row.
#
# Clerk keys are deliberately unset so the api falls back to test-header auth
# (apps/api/src/plugins/auth.ts) — that lets us POST as the seeded demo user
# without a browser session.
#
# Two environment quirks this script works around:
#   - `tsx -e` transpiles to CJS, so top-level await is a syntax error. Every
#     inline query is wrapped in an async IIFE.
#   - Prisma logs its connection pool to stdout, so results carry a PROBE=
#     marker and are grepped out rather than read positionally.

set -uo pipefail
cd /Users/yashbhalgat/code/dentabill

LOG_DIR="${TMPDIR:-/tmp}/dentabill-pipeline"
mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*.log

DEMO_USER="demo_bright_smile_user"
DEMO_ORG="demo_bright_smile_org"

export NODE_ENV=development
export RETELL_API_KEY=""
export DEMO_AUTOPILOT=true
export SUMMARIZER_AUTO_TRANSITION_ENABLED=true
# FakeClaude is fixture-driven; without this a real (non-test) call produces
# no summary, the job dead-letters, and the claim never transitions.
export DEMO_SUMMARIZER_FALLBACK=true
# Payer lines are closed evenings/weekends; without this the enqueue 422s.
export DEMO_IGNORE_PAYER_HOURS=true
export CLERK_SECRET_KEY=""
export CLERK_PUBLISHABLE_KEY=""
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=""

probe() {
  # $1 = TypeScript body with access to `prisma`; must console.log('PROBE=' + …)
  (cd apps/api && pnpm exec tsx -e "
void (async () => {
  const { prisma } = await import('@dentabill/db');
  try { $1 } finally { await prisma.\$disconnect(); }
})();
" 2>/dev/null | grep '^PROBE=' | head -1 | sed 's/^PROBE=//')
}

cleanup() {
  echo ""
  echo "── shutting down ──"
  # Kill the whole process GROUP for each service. Killing only the subshell
  # pid orphans its `tsx` child, which keeps holding :3010/:3011 and makes the
  # next run die with EADDRINUSE.
  for pid in ${API_PID:-} ${CALL_PID:-} ${SUM_PID:-}; do
    [ -n "$pid" ] && kill -TERM "-$pid" 2>/dev/null
  done
  sleep 2
  for pid in ${API_PID:-} ${CALL_PID:-} ${SUM_PID:-}; do
    [ -n "$pid" ] && kill -KILL "-$pid" 2>/dev/null
  done
  # Backstop: anything still bound to the three ports is ours.
  for port in 3001 3010 3011; do
    for p in $(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null); do kill -KILL "$p" 2>/dev/null; done
  done
  wait 2>/dev/null
}
trap cleanup EXIT

echo "── booting services ──"
set -m
(cd apps/api && pnpm exec tsx src/server.ts >"$LOG_DIR/api.log" 2>&1) &
API_PID=$!
(cd apps/call-worker && pnpm exec tsx src/bin.ts >"$LOG_DIR/call-worker.log" 2>&1) &
CALL_PID=$!
(cd apps/summary-worker && pnpm exec tsx src/bin.ts >"$LOG_DIR/summary-worker.log" 2>&1) &
SUM_PID=$!
set +m

echo -n "waiting for api /v1/readyz "
code=""
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/v1/readyz 2>/dev/null)
  if [ "$code" = "200" ]; then echo "→ 200 OK"; break; fi
  echo -n "."
  sleep 1
done
if [ "$code" != "200" ]; then
  echo " FAILED (last=$code)"
  echo "--- api.log ---"; tail -30 "$LOG_DIR/api.log"
  exit 1
fi

echo "readyz body: $(curl -s http://127.0.0.1:3001/v1/readyz)"

CLAIM_ID=$(probe "
  const c = await prisma.claim.findFirst({
    where: { status: 'PENDING', organization: { clerkOrgId: '$DEMO_ORG' } },
    orderBy: { priority: 'desc' },
    select: { id: true, claimNumber: true, payerCode: true },
  });
  console.log('PROBE=' + (c ? c.id : ''));
")

if [ -z "$CLAIM_ID" ]; then
  echo "No PENDING claim found — run 'pnpm --filter @dentabill/api seed:demo' first."
  exit 1
fi
echo "claim under test: $CLAIM_ID"

echo ""
echo "── enqueuing call (the 'Call Now' path) ──"
curl -s -X POST "http://127.0.0.1:3001/v1/claims/$CLAIM_ID/calls" \
  -H "x-test-user-id: $DEMO_USER" \
  -H 'content-type: application/json' \
  -d '{}' -w '\nHTTP %{http_code}\n'

echo ""
echo "── watching the pipeline (up to 180s) ──"
for i in $(seq 1 60); do
  STATE=$(probe "
    const claim = await prisma.claim.findUnique({ where: { id: '$CLAIM_ID' }, select: { status: true } });
    const call = await prisma.call.findFirst({ where: { claimId: '$CLAIM_ID' }, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, durationSeconds: true } });
    const events = call ? await prisma.callEvent.count({ where: { callId: call.id } }) : 0;
    const summary = call ? await prisma.callSummary.findFirst({ where: { callId: call.id }, select: { id: true, claimStatus: true, confidence: true } }) : null;
    const audits = await prisma.auditLog.count({ where: { resourceId: '$CLAIM_ID' } });
    console.log('PROBE=' + JSON.stringify({ claim: claim?.status, call: call?.status, dur: call?.durationSeconds, events, summary: summary?.id ?? null, outcome: summary?.claimStatus ?? null, conf: summary?.confidence ?? null, audits }));
  ")
  echo "[${i}] $STATE"
  case "$STATE" in *'"summary":"c'*) echo ""; echo "SUMMARY PRODUCED — pipeline closed the loop"; break;; esac
  sleep 3
done

echo ""
echo "── audit trail for this claim ──"
probe "
  const rows = await prisma.auditLog.findMany({ where: { resourceId: '$CLAIM_ID' }, orderBy: { createdAt: 'asc' }, select: { action: true, resourceType: true, metadata: true } });
  console.log('PROBE=' + JSON.stringify(rows, null, 0));
" | python3 -c "import sys,json;[print(' -',r['action'],'|',r['resourceType'],'|',json.dumps(r['metadata'])) for r in json.load(sys.stdin)]" 2>/dev/null || echo "(no audit rows)"

echo ""
echo "── worker logs (tail) ──"
echo "--- call-worker ---"; tail -15 "$LOG_DIR/call-worker.log"
echo "--- summary-worker ---"; tail -15 "$LOG_DIR/summary-worker.log"
