#!/usr/bin/env bash
# PostToolUse — warns when PHI field names appear inside console/logger calls

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))" 2>/dev/null || echo "")

case "$TOOL" in
  Edit)
    CONTENT=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('new_string',''))" 2>/dev/null || echo "")
    FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
    ;;
  Write)
    CONTENT=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('content',''))" 2>/dev/null || echo "")
    FILE_PATH=$(printf '%s' "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('file_path',''))" 2>/dev/null || echo "")
    ;;
  *)
    exit 0
    ;;
esac

# Skip test and spec files
printf '%s' "$FILE_PATH" | grep -qE '(\.(test|spec)\.(ts|tsx|js|jsx)|__tests__/)' && exit 0

[ -z "$CONTENT" ] && exit 0

LOG_LINES=$(printf '%s' "$CONTENT" | grep -iE 'console\.(log|error|warn|info)|logger\.(log|error|warn|info|debug|trace)' || true)
[ -z "$LOG_LINES" ] && exit 0

PHI_HIT=$(printf '%s' "$LOG_LINES" | grep -iE '\b(patientName|ssn|dob|dateOfBirth|memberName|subscriberName|firstName|lastName|memberId|claimantName)\b' || true)
if [ -n "$PHI_HIT" ]; then
  printf 'PHI WARNING: A log statement in %s may reference a PHI field. HIPAA prohibits logging patient identifiers. Use anonymized IDs (patientId, claimId) only.\n' "$FILE_PATH"
fi

exit 0
