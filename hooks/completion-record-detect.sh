#!/usr/bin/env bash
# completion-record-detect.sh — SubagentStop/Stop completion-record DETECTOR
# entrypoint (story wr-1-completion-record-detector).
#
# Thin shell shim only (charter: Python is canonical for detector logic). This
# script extracts `cwd` from the hook payload on stdin and hands off to
# hive/lib/completion_record_detector.py, which resolves the epic from the git
# branch, inspects for a standard process record, and prints WARN lines to
# stderr for anything missing/malformed. It DETECTS and WARNS — it cannot and
# does not block completion (see design-discussion.md sec 0b, H1/P1).
#
# Always exits 0 (handler isolation — same convention as
# notify-agent-complete.sh / metrics-stop-dispatch.sh).

set -uo pipefail
trap 'exit 0' ERR

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"

HOOK_INPUT=$(cat 2>/dev/null || echo "")

_json_field() {
  local key="$1"
  if command -v jq &>/dev/null; then
    printf '%s' "$HOOK_INPUT" | jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
    return
  fi
  if command -v python3 &>/dev/null; then
    printf '%s' "$HOOK_INPUT" | python3 -c '
import json, sys
try:
    obj = json.load(sys.stdin)
    v = obj.get(sys.argv[1], "")
    print(v if isinstance(v, str) else ("" if v is None else json.dumps(v)))
except Exception:
    pass
' "$key" 2>/dev/null
    return
  fi
  echo ""
}

HOOK_CWD=$(_json_field "cwd")
DETECTOR_CWD="${HOOK_CWD:-$HIVE_ROOT}"

if command -v python3 &>/dev/null; then
  HIVE_ROOT="$HIVE_ROOT" HIVE_DETECTOR_CWD="$DETECTOR_CWD" PYTHONPATH="$HIVE_ROOT${PYTHONPATH:+:$PYTHONPATH}" \
    python3 "$HIVE_ROOT/hive/lib/completion_record_detector.py" 1>&2 || true
fi

exit 0
