#!/usr/bin/env bash
# SessionStart — surface the "Next task" line and last activity from docs/SESSION_CONTEXT.md
# so each new session begins with a known landing point instead of re-exploration.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CTX="$REPO_ROOT/docs/SESSION_CONTEXT.md"
PROGRESS="$REPO_ROOT/PROGRESS.md"

[ -f "$CTX" ] || exit 0

# Extract the "Next task" section (up to next ## heading or 10 lines, whichever first)
NEXT_TASK=$(awk '
  /^##[[:space:]]+Next task/ { flag=1; print; next }
  flag && /^##[[:space:]]/ { exit }
  flag { print; n++; if (n>10) exit }
' "$CTX")

# Most recent dated entry (last 8 lines of file as a cheap proxy)
RECENT=$(tail -n 8 "$CTX" 2>/dev/null)

# Current phase line from PROGRESS.md
PHASE=""
if [ -f "$PROGRESS" ]; then
  PHASE=$(grep -m1 -iE '^(##[[:space:]]*)?(current phase|phase[[:space:]]*[0-9])' "$PROGRESS" 2>/dev/null || true)
fi

{
  echo "## Session warmup (from docs/SESSION_CONTEXT.md)"
  [ -n "$PHASE" ] && echo "$PHASE"
  echo ""
  if [ -n "$NEXT_TASK" ]; then
    echo "$NEXT_TASK"
  else
    echo "_No 'Next task' section found in docs/SESSION_CONTEXT.md._"
  fi
} 2>/dev/null

exit 0
