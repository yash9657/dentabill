#!/usr/bin/env bash
# PreCompact — nudge to capture the "Next task" pointer in docs/SESSION_CONTEXT.md
# before context summarization obscures it. Fires before auto- or manual /compact.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
STATE_DIR="$REPO_ROOT/.claude/state"
mkdir -p "$STATE_DIR" 2>/dev/null || true

# Record compaction timestamp (silent — used by session-start.sh on next session)
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STATE_DIR/last-compaction.txt" 2>/dev/null || true

# Emit a single-line reminder to the model
echo "Context compaction starting. Before the summary lands, ensure docs/SESSION_CONTEXT.md has an accurate 'Next task' line and any unresolved open questions."

exit 0
