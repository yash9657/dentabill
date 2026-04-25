#!/usr/bin/env bash
# PreToolUse — blocks reading .env files that may contain secrets or PHI

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")

BASENAME=$(basename "$FILE_PATH")

if [[ "$BASENAME" == .env || ( "$BASENAME" == .env.* && "$BASENAME" != .env.example ) ]]; then
  printf 'BLOCKED: Reading %s is not permitted. Check .env.example for available variable names and reference them as process.env.VAR_NAME in code.\n' "$FILE_PATH" >&2
  exit 2
fi

exit 0
