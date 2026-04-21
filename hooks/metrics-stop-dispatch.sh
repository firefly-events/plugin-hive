#!/bin/bash
# metrics-stop-dispatch.sh — Stop-hook metrics dispatcher (C2.2)
#
# Reads hive.config.yaml for metrics.enabled and metrics.dir.
# If enabled, extracts token totals from the Claude Code JSONL transcript
# (C2.0 chosen mechanism) and writes a story-end JSONL event to
# $metrics_dir/events/. If disabled, exits 0 silently.
# Always exits 0 on internal failure (handler isolation — sentinel must not be
# suppressed by any failure in this script).

# No set -e: use per-line guards (|| exit 0) to avoid partial-write risk (I-4)
set -uo pipefail

# Resolve project root (always the git repo root regardless of cwd at hook time)
# HIVE_REPO_ROOT_OVERRIDE allows tests to inject a fixture root
if [ -n "${HIVE_REPO_ROOT_OVERRIDE:-}" ]; then
  REPO_ROOT="$HIVE_REPO_ROOT_OVERRIDE"
else
  REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || echo ".")"
fi
CONFIG="$REPO_ROOT/hive/hive.config.yaml"

# Always exit 0 on any unhandled error — metrics failure must not suppress sentinel
trap 'exit 0' ERR

# Three-tier YAML-scoped config reader (I-1): yq → python3 yaml.safe_load → awk-scoped grep
# Returns value of metrics.<key>, never matches keys outside the metrics: block
_read_metrics_config() {
  local key="$1"
  local default="$2"
  if [ ! -f "$CONFIG" ]; then
    echo "$default"
    return
  fi
  local val=""
  if command -v yq &>/dev/null; then
    val=$(yq ".metrics.${key}" "$CONFIG" 2>/dev/null | tr -d ' "' || true)
  elif command -v python3 &>/dev/null; then
    val=$(python3 - "$CONFIG" "$key" <<'PYEOF'
import sys
try:
    import yaml
    with open(sys.argv[1]) as f:
        c = yaml.safe_load(f)
    v = c.get('metrics', {}).get(sys.argv[2], '')
    if v is not None and str(v) != '':
        print(str(v).lower() if isinstance(v, bool) else str(v))
except Exception:
    pass
PYEOF
    )
  else
    val=$(awk '/^metrics:/{flag=1; next} /^[a-zA-Z]/{flag=0} flag && /^[[:space:]]+'"$key"':/' "$CONFIG" \
      | head -1 | sed 's/[^:]*:[[:space:]]*//' | tr -d ' "')
  fi
  if [ -z "${val:-}" ] || [ "$val" = "null" ]; then
    echo "$default"
  else
    echo "$val"
  fi
}

# Read configuration
METRICS_ENABLED=$(_read_metrics_config "enabled" "false")
METRICS_DIR=$(_read_metrics_config "dir" ".pHive/metrics")

# Strip leading/trailing whitespace and comment suffixes from yaml values
METRICS_ENABLED=$(echo "$METRICS_ENABLED" | awk '{print $1}')
METRICS_DIR=$(echo "$METRICS_DIR" | awk '{print $1}')

# Gate: if not enabled, exit silently
if [ "$METRICS_ENABLED" != "true" ]; then
  exit 0
fi

# Read Stop hook stdin for session context
HOOK_INPUT=$(cat 2>/dev/null || echo "{}")
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")
HOOK_CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "$REPO_ROOT")

# Resolve absolute metrics dir
if [[ "$METRICS_DIR" != /* ]]; then
  METRICS_DIR="$REPO_ROOT/$METRICS_DIR"
fi

EVENTS_DIR="$METRICS_DIR/events"
mkdir -p "$EVENTS_DIR" || exit 0

# Determine JSONL transcript path using C2.0 mechanism
# ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
_resolve_transcript() {
  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    echo "$TRANSCRIPT_PATH"
    return
  fi

  if [ -z "$SESSION_ID" ]; then
    return
  fi

  local cwd_path="${HOOK_CWD:-$REPO_ROOT}"
  # Encode path: leading slash stripped, remaining slashes become hyphens
  local encoded_cwd
  encoded_cwd=$(echo "$cwd_path" | sed 's|^/||' | sed 's|/|-|g')
  local candidate="$HOME/.claude/projects/$encoded_cwd/$SESSION_ID.jsonl"
  if [ -f "$candidate" ]; then
    echo "$candidate"
  fi
}

JSONL_PATH=$(_resolve_transcript)

# Extract token totals from JSONL using C2.0 jq pipeline
_extract_tokens() {
  local jsonl="$1"
  if [ -z "$jsonl" ] || [ ! -f "$jsonl" ]; then
    echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true}'
    return
  fi

  # Slurp mode for aggregation across all assistant rows (C2.0 edge case #4)
  jq -c -s '
    [.[] | select(.type == "assistant" and .message.usage != null)]
    | {
        input_tokens: (map(.message.usage.input_tokens // 0) | add // 0),
        output_tokens: (map(.message.usage.output_tokens // 0) | add // 0),
        cache_creation_input_tokens: (map(.message.usage.cache_creation_input_tokens // 0) | add // 0),
        cache_read_input_tokens: (map(.message.usage.cache_read_input_tokens // 0) | add // 0),
        model: ([ .[] | .message.model ] | unique | join(",")),
        codex_gap: false
      }
  ' "$jsonl" 2>/dev/null || echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true}'
}

TOKENS_JSON=$(_extract_tokens "$JSONL_PATH")

INPUT_TOKENS=$(echo "$TOKENS_JSON" | jq -r '.input_tokens // 0')
OUTPUT_TOKENS=$(echo "$TOKENS_JSON" | jq -r '.output_tokens // 0')
CACHE_CREATION=$(echo "$TOKENS_JSON" | jq -r '.cache_creation_input_tokens // 0')
CACHE_READ=$(echo "$TOKENS_JSON" | jq -r '.cache_read_input_tokens // 0')
MODEL=$(echo "$TOKENS_JSON" | jq -r '.model // "unknown"')
CODEX_GAP=$(echo "$TOKENS_JSON" | jq -r '.codex_gap // false')
TOTAL_TOKENS=$((INPUT_TOKENS + OUTPUT_TOKENS))

# Wall-clock end time
END_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Use unix timestamp in ms — macOS date lacks %3N; fall back to seconds * 1000
# If both fail, WALL_CLOCK_MS remains empty (I-3: omit row rather than emit misleading 0)
WALL_CLOCK_MS=$(python3 -c "import time; print(int(time.time()*1000))" 2>/dev/null \
  || awk 'BEGIN{print int(systime()*1000)}' 2>/dev/null \
  || true)

# Build event_id and run_id
EVENT_TS=$(date -u +%Y-%m-%dT%H%M%SZ)
EVENT_ID="evt_${EVENT_TS}_stop"
RUN_ID="run_stop_${SESSION_ID:-unknown}_${EVENT_TS}"

# Determine target events file (one file per session)
SESSION_SLUG="${SESSION_ID:-unknown}"
EVENTS_FILE="$EVENTS_DIR/stop-${SESSION_SLUG}.jsonl"

# Emit token metric row
TOKEN_ROW=$(jq -nc \
  --arg event_id "$EVENT_ID" \
  --arg ts "$END_TS" \
  --arg run_id "$RUN_ID" \
  --arg swarm_id "meta-improvement-system" \
  --arg session_id "$SESSION_ID" \
  --argjson value "$TOTAL_TOKENS" \
  --arg model "$MODEL" \
  --argjson input_t "$INPUT_TOKENS" \
  --argjson output_t "$OUTPUT_TOKENS" \
  --argjson cache_c "$CACHE_CREATION" \
  --argjson cache_r "$CACHE_READ" \
  --argjson codex_gap "$CODEX_GAP" \
  '{
    event_id: $event_id,
    timestamp: $ts,
    run_id: $run_id,
    swarm_id: $swarm_id,
    story_id: "session-end",
    phase: "stop-hook",
    agent: "stop-hook-dispatcher",
    metric_type: "tokens",
    value: $value,
    unit: "tokens",
    dimensions: {
      session_id: $session_id,
      model: $model,
      input_tokens: $input_t,
      output_tokens: $output_t,
      cache_creation_input_tokens: $cache_c,
      cache_read_input_tokens: $cache_r,
      codex_gap: $codex_gap
    },
    source: "stop-hook-jsonl-transcript"
  }')

echo "$TOKEN_ROW" >> "$EVENTS_FILE" || exit 0

# Emit wall_clock_ms row only when value is available (I-3: skip rather than emit 0)
if [ -n "${WALL_CLOCK_MS:-}" ]; then
  WALL_EVENT_ID="evt_${EVENT_TS}_stop_wall"
  WALL_ROW=$(jq -nc \
    --arg event_id "$WALL_EVENT_ID" \
    --arg ts "$END_TS" \
    --arg run_id "$RUN_ID" \
    --arg swarm_id "meta-improvement-system" \
    --arg session_id "$SESSION_ID" \
    --argjson value "$WALL_CLOCK_MS" \
    '{
      event_id: $event_id,
      timestamp: $ts,
      run_id: $run_id,
      swarm_id: $swarm_id,
      story_id: "session-end",
      phase: "stop-hook",
      agent: "stop-hook-dispatcher",
      metric_type: "wall_clock_ms",
      value: $value,
      unit: "ms",
      dimensions: {
        session_id: $session_id
      },
      source: "stop-hook-wall-clock"
    }')
  echo "$WALL_ROW" >> "$EVENTS_FILE" || exit 0
fi

exit 0
