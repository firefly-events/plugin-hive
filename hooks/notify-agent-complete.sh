#!/usr/bin/env bash
# notify-agent-complete.sh — SubagentStop event handler (E5 s1, event-driven
# completion spine).
#
# Writes ${state_dir}/agent-complete/<agent_id>/complete.json from the frozen
# SubagentStop payload (see
# .pHive/epics/e5-execution-loop/stories/s1-subagentstop-spine.yaml).
#
# PROBE-FROZEN CONTRACT (CC 2.1.200, do NOT deviate):
# - SubagentStop is the only lifecycle hook that fires for bg/worktree agents.
# - The payload has no exit-status field. background_tasks[].status reads a
#   stale "running" at SubagentStop time and MUST NOT be used as a verdict.
# - Verdict comes ONLY from a self-written status marker
#   (<cwd>/.hive-task-status.json). A missing or unreadable marker is always
#   recorded as "failure" — never silently upgraded to "success".
#
# Always exits 0: a broken script must not break every session (global
# hook registration — I-4 handler isolation, same convention as
# metrics-stop-dispatch.sh).

set -uo pipefail
trap 'exit 0' ERR

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"

# _resolve_state_dir's target_project fallback is $PWD (the shell-shim
# contract: callers `cd` to their intended root first — see common.sh /
# hive/lib/config.py resolve_state_dir docstring). This hook's actual
# process cwd is the SubagentStop payload's agent cwd (a bg/worktree path),
# which is NOT the executor's project root — so resolve from HIVE_ROOT
# explicitly instead of inheriting $PWD, keeping writer/reader agreement
# invocation-cwd-independent.
_marker_state_dir() {
  (cd "$HIVE_ROOT" 2>/dev/null && _resolve_state_dir)
}

_log_anomaly() {
  # Best-effort anomaly log; never allowed to fail the hook.
  local msg="$1"
  local log_dir
  log_dir="$(_marker_state_dir)/agent-complete" 2>/dev/null || log_dir="/tmp/hive-agent-complete"
  mkdir -p "$log_dir" 2>/dev/null || true
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" "$msg" \
    >> "$log_dir/anomalies.log" 2>/dev/null || true
}

# Extract a top-level string/scalar field from JSON on stdin.
# jq -> python3 json.load fallback (I-1 three-tier convention from common.sh).
_json_field() {
  local key="$1"
  if command -v jq &>/dev/null; then
    jq -r --arg k "$key" '.[$k] // empty' 2>/dev/null
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 -c '
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
  cat >/dev/null
  echo ""
}

# Same as _json_field but reads a file instead of stdin (used for the
# self-written status marker).
_json_field_file() {
  local file="$1" key="$2"
  if command -v jq &>/dev/null; then
    jq -r --arg k "$key" '.[$k] // empty' "$file" 2>/dev/null
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        obj = json.load(f)
    v = obj.get(sys.argv[2], "")
    print(v if isinstance(v, str) else ("" if v is None else json.dumps(v)))
except Exception:
    pass
' "$file" "$key" 2>/dev/null
    return
  fi
  echo ""
}

_json_nested_field() {
  local key1="$1" key2="$2"
  if command -v jq &>/dev/null; then
    jq -r --arg k1 "$key1" --arg k2 "$key2" '.[$k1][$k2] // empty' 2>/dev/null
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 -c '
import json, sys
try:
    obj = json.load(sys.stdin)
    v = (obj.get(sys.argv[1]) or {}).get(sys.argv[2], "")
    print(v if isinstance(v, str) else ("" if v is None else json.dumps(v)))
except Exception:
    pass
' "$key1" "$key2" 2>/dev/null
    return
  fi
  cat >/dev/null
  echo ""
}

_is_valid_json() {
  local payload="$1"
  if command -v jq &>/dev/null; then
    printf '%s' "$payload" | jq -e . >/dev/null 2>&1
    return $?
  fi
  if command -v python3 &>/dev/null; then
    printf '%s' "$payload" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1
    return $?
  fi
  # No JSON tool available at all — cannot safely parse; treat as invalid.
  return 1
}

HOOK_INPUT=$(cat 2>/dev/null || echo "")
if [ -z "$HOOK_INPUT" ]; then
  _log_anomaly "empty payload on stdin"
  exit 0
fi

if ! _is_valid_json "$HOOK_INPUT"; then
  _log_anomaly "malformed JSON payload (unparseable)"
  exit 0
fi

STOP_HOOK_ACTIVE=$(printf '%s' "$HOOK_INPUT" | _json_field "stop_hook_active")
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

AGENT_ID=$(printf '%s' "$HOOK_INPUT" | _json_field "agent_id")
if [ -z "$AGENT_ID" ]; then
  _log_anomaly "payload missing agent_id"
  exit 0
fi

SESSION_ID=$(printf '%s' "$HOOK_INPUT" | _json_field "session_id")
AGENT_TYPE=$(printf '%s' "$HOOK_INPUT" | _json_field "agent_type")
HOOK_CWD=$(printf '%s' "$HOOK_INPUT" | _json_field "cwd")
AGENT_TRANSCRIPT=$(printf '%s' "$HOOK_INPUT" | _json_field "agent_transcript_path")
LAST_MESSAGE=$(printf '%s' "$HOOK_INPUT" | _json_field "last_assistant_message")
PROMPT_ID=$(printf '%s' "$HOOK_INPUT" | _json_field "prompt_id")
PERMISSION_MODE=$(printf '%s' "$HOOK_INPUT" | _json_field "permission_mode")
EFFORT_LEVEL=$(printf '%s' "$HOOK_INPUT" | _json_nested_field "effort" "level")

STATE_DIR=$(_marker_state_dir 2>/dev/null || echo "$PLUGIN_ROOT/.pHive")
OUT_DIR="$STATE_DIR/agent-complete/$AGENT_ID"
mkdir -p "$OUT_DIR" 2>/dev/null || { _log_anomaly "could not create $OUT_DIR"; exit 0; }

# Verdict derivation — self-written status marker ONLY. Never
# background_tasks[].status (frozen contract: stale "running" at
# SubagentStop time). Missing/unreadable/unrecognized marker = failure.
VERDICT="failure"
VERDICT_SOURCE="missing_marker"
if [ -n "$HOOK_CWD" ]; then
  STATUS_MARKER="$HOOK_CWD/.hive-task-status.json"
  if [ -f "$STATUS_MARKER" ]; then
    MARKER_STATUS=$(_json_field_file "$STATUS_MARKER" "status")
    if [ "$MARKER_STATUS" = "success" ]; then
      VERDICT="success"
      VERDICT_SOURCE="status_marker"
    else
      VERDICT="failure"
      VERDICT_SOURCE="status_marker"
    fi
  fi
fi

WRITTEN_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")

if command -v jq &>/dev/null; then
  jq -n \
    --arg agent_id "$AGENT_ID" \
    --arg session_id "$SESSION_ID" \
    --arg agent_type "$AGENT_TYPE" \
    --arg cwd "$HOOK_CWD" \
    --arg agent_transcript_path "$AGENT_TRANSCRIPT" \
    --arg last_assistant_message "$LAST_MESSAGE" \
    --arg prompt_id "$PROMPT_ID" \
    --arg permission_mode "$PERMISSION_MODE" \
    --arg effort_level "$EFFORT_LEVEL" \
    --arg verdict "$VERDICT" \
    --arg verdict_source "$VERDICT_SOURCE" \
    --arg written_at "$WRITTEN_AT" \
    '{
      agent_id: $agent_id,
      session_id: $session_id,
      agent_type: $agent_type,
      cwd: $cwd,
      agent_transcript_path: $agent_transcript_path,
      last_assistant_message: $last_assistant_message,
      prompt_id: $prompt_id,
      permission_mode: $permission_mode,
      effort: {level: $effort_level},
      verdict: $verdict,
      verdict_source: $verdict_source,
      written_at: $written_at
    }' > "$OUT_DIR/complete.json.tmp" 2>/dev/null
elif command -v python3 &>/dev/null; then
  python3 -c '
import json, sys
agent_id, session_id, agent_type, cwd, transcript, last_msg, prompt_id, permission_mode, effort_level, verdict, verdict_source, written_at = sys.argv[1:13]
print(json.dumps({
    "agent_id": agent_id,
    "session_id": session_id,
    "agent_type": agent_type,
    "cwd": cwd,
    "agent_transcript_path": transcript,
    "last_assistant_message": last_msg,
    "prompt_id": prompt_id,
    "permission_mode": permission_mode,
    "effort": {"level": effort_level},
    "verdict": verdict,
    "verdict_source": verdict_source,
    "written_at": written_at,
}))
' "$AGENT_ID" "$SESSION_ID" "$AGENT_TYPE" "$HOOK_CWD" "$AGENT_TRANSCRIPT" "$LAST_MESSAGE" "$PROMPT_ID" "$PERMISSION_MODE" "$EFFORT_LEVEL" "$VERDICT" "$VERDICT_SOURCE" "$WRITTEN_AT" \
    > "$OUT_DIR/complete.json.tmp" 2>/dev/null
else
  _log_anomaly "neither jq nor python3 available — cannot write complete.json"
  exit 0
fi

if [ -s "$OUT_DIR/complete.json.tmp" ]; then
  mv "$OUT_DIR/complete.json.tmp" "$OUT_DIR/complete.json" 2>/dev/null || true
else
  rm -f "$OUT_DIR/complete.json.tmp" 2>/dev/null || true
fi

exit 0
