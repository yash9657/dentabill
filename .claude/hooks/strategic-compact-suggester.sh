#!/usr/bin/env bash
# PostToolUse on Edit|Write — counts edits in the current session and suggests
# /compact at logical phase boundaries instead of waiting for auto-compact.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE_DIR="$REPO_ROOT/.claude/state"
mkdir -p "$STATE_DIR" 2>/dev/null || true

# Per-shell-session counter (PPID is stable for the duration of one Claude Code session)
COUNTER_FILE="$STATE_DIR/edit-count-$PPID.txt"
THRESHOLD="${DENTABILL_COMPACT_THRESHOLD:-40}"

if [ -f "$COUNTER_FILE" ]; then
  count=$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)
  count=$((count + 1))
else
  count=1
fi
echo "$count" > "$COUNTER_FILE" 2>/dev/null || true

# Suggest compact at threshold and every threshold thereafter, not on every call
if [ "$count" -ge "$THRESHOLD" ] && [ $((count % THRESHOLD)) -eq 0 ]; then
  echo "[strategic-compact] $count file edits this session. If you're between logical phases, consider running /compact to keep the context window healthy." >&2
fi

# Best-effort cleanup of stale counter files (older than 24h)
find "$STATE_DIR" -maxdepth 1 -name 'edit-count-*.txt' -mtime +1 -delete 2>/dev/null || true

exit 0
