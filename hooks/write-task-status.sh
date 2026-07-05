#!/usr/bin/env bash
# write-task-status.sh — self-written completion marker (E5 s1 write side).
#
# The design (design-discussion.md §2 Probe result, §4 R1) mandates that a
# dispatched story agent write its own pass/fail verdict, since the
# SubagentStop payload carries no exit-status field. This script is the
# agent-invoked writer half of that contract; hooks/notify-agent-complete.sh
# is the reader half. Agents dispatched via the tmux `Agent(name:)` path
# (the only path SubagentStop fires for — see design-discussion.md §2) MUST
# call this as their last action before finishing:
#
#   bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" success
#   bash "${CLAUDE_PLUGIN_ROOT}/hooks/write-task-status.sh" failure
#
# Writes <cwd>/.hive-task-status.json (cwd = the invoking agent's own
# worktree, matching the HOOK_CWD the SubagentStop payload will later report
# for this same agent). Always exits 0: a broken write must not fail the
# agent's own turn or mask a real failure with a script crash.

set -uo pipefail
trap 'exit 0' ERR

STATUS="${1:-}"
if [ "$STATUS" != "success" ] && [ "$STATUS" != "failure" ]; then
  echo "usage: write-task-status.sh <success|failure>" >&2
  exit 0
fi

WRITTEN_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
OUT_FILE="$PWD/.hive-task-status.json"
TMP_FILE="$OUT_FILE.tmp.$$"

if command -v jq &>/dev/null; then
  jq -n --arg status "$STATUS" --arg written_at "$WRITTEN_AT" \
    '{status: $status, written_at: $written_at}' > "$TMP_FILE" 2>/dev/null
elif command -v python3 &>/dev/null; then
  python3 -c '
import json, sys
status, written_at = sys.argv[1:3]
print(json.dumps({"status": status, "written_at": written_at}))
' "$STATUS" "$WRITTEN_AT" > "$TMP_FILE" 2>/dev/null
else
  printf '{"status": "%s", "written_at": "%s"}\n' "$STATUS" "$WRITTEN_AT" > "$TMP_FILE" 2>/dev/null
fi

if [ -s "$TMP_FILE" ]; then
  mv "$TMP_FILE" "$OUT_FILE" 2>/dev/null || true
else
  rm -f "$TMP_FILE" 2>/dev/null || true
fi

exit 0
