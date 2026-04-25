#!/usr/bin/env bash
# PreToolUse — blocks writing API keys and private keys to source files

set -euo pipefail

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

case "$TOOL" in
  Write)
    CONTENT=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('content',''))" 2>/dev/null || echo "")
    ;;
  Edit)
    CONTENT=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('new_string',''))" 2>/dev/null || echo "")
    ;;
  *)
    exit 0
    ;;
esac

[ -z "$CONTENT" ] && exit 0

if printf '%s' "$CONTENT" | grep -qE '(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|AKIA[A-Z0-9]{16}|xoxb-[a-zA-Z0-9-]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY)'; then
  printf 'BLOCKED: Hardcoded secret detected (API key or private key pattern). Add the variable to .env.example and reference it via process.env.VAR_NAME instead.\n' >&2
  exit 2
fi

exit 0
