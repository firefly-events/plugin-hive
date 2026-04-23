#!/usr/bin/env bash
# metrics-token-capture.sh — C2.3 per-agent token capture helper
#
# Reads the Claude Code JSONL transcript (C2.0 chosen mechanism) and emits
# one JSONL metrics event per attributable agent (subagent) invocation found
# in the subagents/ directory under the session.
#
# Main-thread rows (isSidechain=false) are attributed to "orchestrator".
# Subagent rows are attributed via agent-<id>.meta.json agentType.
#
# Graceful degradation (AC-3):
#   When a specific agent's JSONL has no assistant rows with usage data
#   (e.g., Codex-backed agent), the row is emitted with value: 0 and
#   dimensions.codex_gap: true. This documents absence without crashing.
#
# Usage (called programmatically, not as a hook stdin consumer):
#   metrics-token-capture.sh \
#     --session-id  <sid>        \
#     --transcript  <path>       \   # optional: skip JSONL path resolution
#     --run-id      <run_id>     \
#     --story-id    <story_id>   \   # mutually exclusive with --proposal-id
#     [--proposal-id <id>]       \
#     [--swarm-id   <swarm_id>]  \
#     [--phase      <phase>]     \
#     [--cwd        <cwd>]
#
# Emits rows to $HIVE_ROOT/$metrics_dir/events/token-<session_id>.jsonl
# Silent no-op when metrics.enabled is false.
# Always exits 0 (metrics failure must not break callers per D4).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"
CONFIG_FILE="${CONFIG_FILE:-$HIVE_ROOT/hive.config.yaml}"

trap 'exit 0' ERR

# Three-tier YAML-scoped config reader (pattern parity with sibling hooks)
_read_metrics_config() {
  local key="$1"
  local default="$2"
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "$default"
    return
  fi
  local val=""
  if command -v yq &>/dev/null; then
    val=$(yq ".metrics.${key}" "$CONFIG_FILE" 2>/dev/null | tr -d ' "' || true)
  elif command -v python3 &>/dev/null; then
    val=$(python3 - "$CONFIG_FILE" "$key" <<'PYEOF'
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
    val=$(awk '/^metrics:/{flag=1; next} /^[a-zA-Z]/{flag=0} flag && /^[[:space:]]+'"$key"':/' "$CONFIG_FILE" \
      | head -1 | sed 's/[^:]*:[[:space:]]*//' | tr -d ' "')
  fi
  if [ -z "${val:-}" ] || [ "$val" = "null" ]; then
    echo "$default"
  else
    echo "$val"
  fi
}

METRICS_ENABLED=$(_read_metrics_config "enabled" "false")
STATE_DIR=$(_resolve_state_dir)

METRICS_ENABLED=$(echo "$METRICS_ENABLED" | awk '{print $1}')

if [ "$METRICS_ENABLED" != "true" ]; then
  exit 0
fi

# Parse arguments
session_id=""
transcript_path=""
run_id=""
story_id=""
proposal_id=""
swarm_id=""
phase=""
cwd_arg=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id)  session_id="$2";   shift 2 ;;
    --transcript)  transcript_path="$2"; shift 2 ;;
    --run-id)      run_id="$2";       shift 2 ;;
    --story-id)    story_id="$2";     shift 2 ;;
    --proposal-id) proposal_id="$2";  shift 2 ;;
    --swarm-id)    swarm_id="$2";     shift 2 ;;
    --phase)       phase="$2";        shift 2 ;;
    --cwd)         cwd_arg="$2";      shift 2 ;;
    *) echo "metrics-token-capture: unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$run_id" ]; then
  echo "metrics-token-capture: --run-id is required" >&2
  exit 1
fi
if [ -z "$story_id" ] && [ -z "$proposal_id" ]; then
  echo "metrics-token-capture: one of --story-id or --proposal-id is required" >&2
  exit 1
fi
if [ -n "$story_id" ] && [ -n "$proposal_id" ]; then
  echo "metrics-token-capture: --story-id and --proposal-id are mutually exclusive" >&2
  exit 1
fi

METRICS_DIR="$STATE_DIR/metrics"
EVENTS_DIR="$METRICS_DIR/events"
mkdir -p "$EVENTS_DIR" || exit 0

# Resolve the main session JSONL path using C2.0 mechanism
_resolve_main_jsonl() {
  if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    echo "$transcript_path"
    return
  fi
  if [ -z "$session_id" ]; then
    return
  fi
  local base="${cwd_arg:-$HIVE_ROOT}"
  local encoded_cwd
  encoded_cwd=$(echo "$base" | sed 's|^/||' | sed 's|[^a-zA-Z0-9-]|-|g')
  local candidate="$HOME/.claude/projects/$encoded_cwd/$session_id.jsonl"
  if [ -f "$candidate" ]; then
    echo "$candidate"
  fi
}

MAIN_JSONL=$(_resolve_main_jsonl)

# Resolve subagents directory (sibling to the main JSONL)
_resolve_subagents_dir() {
  if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    echo "$(dirname "$transcript_path")/subagents"
    return
  fi
  if [ -z "$session_id" ]; then
    return
  fi
  local base="${cwd_arg:-$HIVE_ROOT}"
  local encoded_cwd
  encoded_cwd=$(echo "$base" | sed 's|^/||' | sed 's|[^a-zA-Z0-9-]|-|g')
  echo "$HOME/.claude/projects/$encoded_cwd/$session_id/subagents"
}

SUBAGENTS_DIR=$(_resolve_subagents_dir)

# Emit a single per-agent token event row
# $1: agent label (e.g., "orchestrator" or agentType from meta.json)
# $2: total combined token count (input + output)
# $3: input_tokens
# $4: output_tokens
# $5: cache_creation_input_tokens
# $6: cache_read_input_tokens
# $7: model string (comma-joined if multiple)
# $8: codex_gap (true|false)
_emit_agent_row() {
  local agent_label="$1"
  local total_tokens="$2"
  local input_t="$3"
  local output_t="$4"
  local cache_c="$5"
  local cache_r="$6"
  local model_str="$7"
  local codex_gap="$8"

  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local event_id="evt_${ts}_$$_${RANDOM}_token_${agent_label//[^a-zA-Z0-9_-]/_}"

  local scope_field
  local scope_val
  if [ -n "$story_id" ]; then
    scope_field="story_id"
    scope_val="$story_id"
  else
    scope_field="proposal_id"
    scope_val="$proposal_id"
  fi

  jq -cn \
    --arg event_id    "$event_id" \
    --arg ts          "$ts" \
    --arg run_id      "$run_id" \
    --arg swarm_id    "${swarm_id:-}" \
    --arg scope_field "$scope_field" \
    --arg scope_val   "$scope_val" \
    --arg phase       "${phase:-}" \
    --arg agent       "$agent_label" \
    --argjson value   "$total_tokens" \
    --arg model       "$model_str" \
    --argjson input_t   "$input_t" \
    --argjson output_t  "$output_t" \
    --argjson cache_c   "$cache_c" \
    --argjson cache_r   "$cache_r" \
    --argjson codex_gap "$codex_gap" \
    '
      {
        event_id:    $event_id,
        timestamp:   $ts,
        run_id:      $run_id,
        metric_type: "tokens",
        agent:       $agent,
        value:       $value,
        unit:        "tokens",
        dimensions: {
          model:                      $model,
          input_tokens:               $input_t,
          output_tokens:              $output_t,
          cache_creation_input_tokens: $cache_c,
          cache_read_input_tokens:    $cache_r,
          codex_gap:                  $codex_gap
        },
        source: "jsonl-per-agent-capture"
      }
      | if $swarm_id    != "" then . + {swarm_id:    $swarm_id}    else . end
      | if $phase       != "" then . + {phase:       $phase}       else . end
      | . + {($scope_field): $scope_val}
    ' 2>/dev/null || true
}

# Aggregate tokens from a JSONL file, returns JSON object
# Handles missing usage (codex_gap path), large files via streaming jq
_sum_tokens_from_jsonl() {
  local jsonl_path="$1"

  if [ ! -f "$jsonl_path" ]; then
    echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true,"has_rows":false}'
    return
  fi

  # Stream line-by-line (C2.0 edge case #4 — no slurp for large files)
  jq -c -s '
    [.[] | select(.type == "assistant" and .message.usage != null)]
    | if length == 0 then
        {input_tokens:0, output_tokens:0,
         cache_creation_input_tokens:0, cache_read_input_tokens:0,
         model:"unknown", codex_gap:true, has_rows:false}
      else
        {
          input_tokens:                (map(.message.usage.input_tokens // 0) | add),
          output_tokens:               (map(.message.usage.output_tokens // 0) | add),
          cache_creation_input_tokens: (map(.message.usage.cache_creation_input_tokens // 0) | add),
          cache_read_input_tokens:     (map(.message.usage.cache_read_input_tokens // 0) | add),
          model:                       ([.[].message.model] | unique | join(",")),
          codex_gap:                   false,
          has_rows:                    true
        }
      end
  ' "$jsonl_path" 2>/dev/null || echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true,"has_rows":false}'
}

OUTPUT_FILE="$EVENTS_DIR/token-${session_id:-unknown}.jsonl"

# 1. Main-thread rows (isSidechain=false), attributed to "orchestrator"
if [ -n "$MAIN_JSONL" ] && [ -f "$MAIN_JSONL" ]; then
  MAIN_STATS=$(jq -c -s '
    [.[] | select(.type == "assistant" and .isSidechain == false and .message.usage != null)]
    | if length == 0 then
        {input_tokens:0, output_tokens:0,
         cache_creation_input_tokens:0, cache_read_input_tokens:0,
         model:"unknown", codex_gap:true, has_rows:false}
      else
        {
          input_tokens:                (map(.message.usage.input_tokens // 0) | add),
          output_tokens:               (map(.message.usage.output_tokens // 0) | add),
          cache_creation_input_tokens: (map(.message.usage.cache_creation_input_tokens // 0) | add),
          cache_read_input_tokens:     (map(.message.usage.cache_read_input_tokens // 0) | add),
          model:                       ([.[].message.model] | unique | join(",")),
          codex_gap:                   false,
          has_rows:                    true
        }
      end
  ' "$MAIN_JSONL" 2>/dev/null || echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","codex_gap":true,"has_rows":false}')

  IN=$(echo "$MAIN_STATS" | jq -r '.input_tokens // 0')
  OUT=$(echo "$MAIN_STATS" | jq -r '.output_tokens // 0')
  CC=$(echo "$MAIN_STATS" | jq -r '.cache_creation_input_tokens // 0')
  CR=$(echo "$MAIN_STATS" | jq -r '.cache_read_input_tokens // 0')
  MDL=$(echo "$MAIN_STATS" | jq -r '.model // "unknown"')
  GAP=$(echo "$MAIN_STATS" | jq -r 'if has("codex_gap") then .codex_gap else true end')
  TOTAL=$((IN + OUT))

  ROW=$(_emit_agent_row "orchestrator" "$TOTAL" "$IN" "$OUT" "$CC" "$CR" "$MDL" "$GAP")
  [ -n "$ROW" ] && printf '%s\n' "$ROW" >> "$OUTPUT_FILE"
fi

# 2. Per-subagent rows from subagents/agent-*.jsonl + agent-*.meta.json
if [ -d "$SUBAGENTS_DIR" ]; then
  for meta_file in "$SUBAGENTS_DIR"/agent-*.meta.json; do
    [ -f "$meta_file" ] || continue

    agent_id=$(basename "$meta_file" .meta.json)
    agent_jsonl="$SUBAGENTS_DIR/${agent_id}.jsonl"

    # Read agentType from meta sidecar (C2.0 subagent attribution procedure)
    agent_type=$(jq -r '.agentType // "unknown-agent"' "$meta_file" 2>/dev/null || echo "unknown-agent")
    agent_label="${agent_type}"

    STATS=$(_sum_tokens_from_jsonl "$agent_jsonl")

    IN=$(echo "$STATS" | jq -r '.input_tokens // 0')
    OUT=$(echo "$STATS" | jq -r '.output_tokens // 0')
    CC=$(echo "$STATS" | jq -r '.cache_creation_input_tokens // 0')
    CR=$(echo "$STATS" | jq -r '.cache_read_input_tokens // 0')
    MDL=$(echo "$STATS" | jq -r '.model // "unknown"')
    GAP=$(echo "$STATS" | jq -r 'if has("codex_gap") then .codex_gap else true end')
    TOTAL=$((IN + OUT))

    ROW=$(_emit_agent_row "$agent_label" "$TOTAL" "$IN" "$OUT" "$CC" "$CR" "$MDL" "$GAP")
    [ -n "$ROW" ] && printf '%s\n' "$ROW" >> "$OUTPUT_FILE"
  done
fi

exit 0
