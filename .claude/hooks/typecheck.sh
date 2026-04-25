#!/usr/bin/env bash
# PostToolUse — runs tsc --noEmit in the nearest package after editing a TypeScript file

INPUT=$(cat)

FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ti = d.get('tool_input', {})
print(ti.get('file_path', ''))
" 2>/dev/null || echo "")

# Only TypeScript files
printf '%s' "$FILE_PATH" | grep -qE '\.(ts|tsx)$' || exit 0

# Walk up to find nearest package dir (tsconfig.json + package.json)
CURRENT="$(dirname "$FILE_PATH")"
PACKAGE_DIR=""
while [ "$CURRENT" != "/" ] && [ -n "$CURRENT" ]; do
  if [ -f "$CURRENT/tsconfig.json" ] && [ -f "$CURRENT/package.json" ]; then
    PACKAGE_DIR="$CURRENT"
    break
  fi
  CURRENT="$(dirname "$CURRENT")"
done

[ -z "$PACKAGE_DIR" ] && exit 0

command -v pnpm &>/dev/null || exit 0

cd "$PACKAGE_DIR" || exit 0

RESULT=$(pnpm exec tsc --noEmit --skipLibCheck 2>&1) || true
if [ -n "$RESULT" ]; then
  printf 'TypeScript errors in %s:\n%s\n' "$PACKAGE_DIR" "$RESULT"
fi

exit 0
