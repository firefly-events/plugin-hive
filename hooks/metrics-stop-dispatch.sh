#!/bin/bash
# metrics-stop-dispatch.sh — Stop-hook metrics dispatcher (C2.2)
#
# Reads `metrics.enabled` from the root `hive.config.yaml` and derives the
# metrics events directory via `_resolve_state_dir` in `hooks/common.sh`
# (`paths.state_dir` + `/metrics/events`, default `.pHive/metrics/events`).
# If enabled, extracts token totals from the Claude Code JSONL transcript and
# writes a story-end JSONL event to `${state_dir}/metrics/events/`. If
# disabled, exits 0 silently.
# Always exits 0 on internal failure (handler isolation — sentinel must not be
# suppressed by any failure in this script).
#
# Token extraction (story hqp-6-stop-hook-bound, epic
# headless-question-protocol): a single streaming jq | awk pipeline over the
# JSONL transcript, O(1) memory in transcript size — replaced the original
# `jq -c -s` (slurp) implementation, which loaded the ENTIRE transcript into
# memory before aggregating (benchmarked: ~7.5GB peak RSS and 13.57s wall
# time on an 884MB/3M-line synthetic transcript, right at the edge of the
# 15s plugin.json hook timeout). The streaming pipeline processes the same
# 884MB fixture in ~9.2s using ~2.8MB peak memory — see
# .pHive/epics/headless-question-protocol/stories/hqp-6-stop-hook-bound.yaml
# for the full benchmark. An in-script size guard (below) additionally skips
# the parse entirely above `metrics.stop_dispatch_max_transcript_bytes`
# (default 300MB, benchmarked at ~3.1s / ~12s margin under the timeout),
# rather than relying solely on the harness-level timeout as a backstop.

# No set -e: use per-line guards (|| exit 0) to avoid partial-write risk (I-4)
set -uo pipefail

# Resolve project root (consumer config/state can differ from plugin install dir)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"
REPO_ROOT="$HIVE_ROOT"
CONFIG="${CONFIG:-$REPO_ROOT/hive.config.yaml}"

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
# 300MB default — benchmarked (hqp-6-stop-hook-bound): streaming pipeline
# completes in ~3.1s at this size, ~12s margin under the 15s hook timeout.
MAX_TRANSCRIPT_BYTES=$(_read_metrics_config "stop_dispatch_max_transcript_bytes" "314572800")
STATE_DIR=$(_resolve_state_dir)

# Strip leading/trailing whitespace and comment suffixes from yaml values
METRICS_ENABLED=$(echo "$METRICS_ENABLED" | awk '{print $1}')

# Gate: if not enabled, exit silently
if [ "$METRICS_ENABLED" != "true" ]; then
  exit 0
fi

# Read Stop hook stdin for session context
HOOK_INPUT=$(cat 2>/dev/null || echo "{}")
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")
HOOK_CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "$REPO_ROOT")

METRICS_DIR="$STATE_DIR/metrics"
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

# Size guard (hqp-6-stop-hook-bound): skip the parse entirely above
# MAX_TRANSCRIPT_BYTES rather than let cost scale unboundedly with
# transcript size. Logs one skip row (not silent) and exits 0.
_transcript_size_bytes() {
  local jsonl="$1"
  wc -c <"$jsonl" 2>/dev/null | tr -d ' '
}

if [ -n "$JSONL_PATH" ] && [ -f "$JSONL_PATH" ]; then
  TRANSCRIPT_BYTES=$(_transcript_size_bytes "$JSONL_PATH")
  if [ -n "${TRANSCRIPT_BYTES:-}" ] && [ "$TRANSCRIPT_BYTES" -gt "$MAX_TRANSCRIPT_BYTES" ] 2>/dev/null; then
    SKIP_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    SKIP_ROW=$(jq -nc \
      --arg event_id "evt_$(date -u +%Y-%m-%dT%H%M%SZ)_$$_${RANDOM}_stop_skip" \
      --arg ts "$SKIP_TS" \
      --arg session_id "$SESSION_ID" \
      --argjson bytes "$TRANSCRIPT_BYTES" \
      --argjson threshold "$MAX_TRANSCRIPT_BYTES" \
      '{
        event_id: $event_id,
        timestamp: $ts,
        story_id: "session-end",
        phase: "stop-hook",
        agent: "stop-hook-dispatcher",
        metric_type: "transcript_skipped",
        value: $bytes,
        unit: "bytes",
        dimensions: { session_id: $session_id, threshold_bytes: $threshold },
        source: "stop-hook-size-guard"
      }' 2>/dev/null)
    if [ -n "$SKIP_ROW" ]; then
      EVENTS_FILE="$EVENTS_DIR/stop-${SESSION_ID:-unknown}.jsonl"
      echo "$SKIP_ROW" >>"$EVENTS_FILE" || true
    fi
    exit 0
  fi
fi

# Extract token totals from JSONL using a single streaming jq | awk pass —
# see the file header comment for the benchmark that replaced the original
# `jq -c -s` (slurp) implementation. jq without `-s` reads one JSON value at
# a time (the transcript is already one object per line), keeping jq's own
# memory bounded; awk's accumulator state is O(distinct models), not O(n).
_extract_tokens() {
  local jsonl="$1"
  if [ -z "$jsonl" ] || [ ! -f "$jsonl" ]; then
    echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true}'
    return
  fi

  jq -r '
    select(.type == "assistant" and .message.usage != null)
    | [
        (.message.usage.input_tokens // 0),
        (.message.usage.output_tokens // 0),
        (.message.usage.cache_creation_input_tokens // 0),
        (.message.usage.cache_read_input_tokens // 0),
        (.message.model // "unknown")
      ]
    | @tsv
  ' "$jsonl" 2>/dev/null | awk -F'\t' '
    {
      input += $1; output += $2; cache_c += $3; cache_r += $4
      if (!($5 in seen)) { seen[$5] = 1; n++; models[n] = $5 }
    }
    END {
      # Insertion sort on the (tiny — bounded by distinct model count) models
      # array, to match the original jq `unique` implementation'"'"'s sorted
      # join order byte-for-byte.
      for (i = 2; i <= n; i++) {
        key = models[i]; j = i - 1
        while (j >= 1 && models[j] > key) { models[j+1] = models[j]; j-- }
        models[j+1] = key
      }
      joined = ""
      for (i = 1; i <= n; i++) { joined = (joined == "" ? models[i] : joined "," models[i]) }
      printf("{\"input_tokens\":%d,\"output_tokens\":%d,\"cache_creation_input_tokens\":%d,\"cache_read_input_tokens\":%d,\"model\":\"%s\",\"codex_gap\":false}\n", input, output, cache_c, cache_r, joined)
    }
  ' || echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true}'
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
EVENT_ID="evt_${EVENT_TS}_$$_${RANDOM}_stop"
RUN_ID="run_stop_${SESSION_ID:-unknown}_${EVENT_TS}_$$_${RANDOM}"

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
  WALL_EVENT_ID="evt_${EVENT_TS}_$$_${RANDOM}_stop_wall"
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
