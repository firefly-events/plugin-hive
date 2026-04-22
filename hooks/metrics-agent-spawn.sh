#!/usr/bin/env bash
# metrics-agent-spawn.sh — emit a spawn-scoped metrics event when metrics are enabled.
#
# Call from an agent-spawn entrypoint with env vars set:
#   HIVE_RUN_ID       — required; groups all events in this run
#   HIVE_STORY_ID     — required when spawning for a story (mutually exclusive with HIVE_PROPOSAL_ID)
#   HIVE_PROPOSAL_ID  — required when spawning for a proposal (mutually exclusive with HIVE_STORY_ID)
#   HIVE_SWARM_ID     — optional; identifies the parent swarm
#   HIVE_AGENT        — required; the spawned agent persona (e.g. "developer")
#   HIVE_PHASE        — optional; lifecycle phase at spawn time (e.g. "implement")
#   HIVE_CONFIG       — optional; path to hive.config.yaml (default: hive/hive.config.yaml)
#
# Exit codes:
#   0 — event emitted (or metrics disabled — silent no-op)
#   1 — argument/config error

set -euo pipefail

# Resolve config path anchored to HIVE_ROOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_ROOT="${HIVE_ROOT:-$(dirname "$SCRIPT_DIR")}"
HIVE_CONFIG="${HIVE_CONFIG:-$HIVE_ROOT/hive/hive.config.yaml}"

# Three-tier YAML-scoped config reader (I-4): yq → python3 yaml.safe_load → awk-scoped grep
# Returns value of metrics.<key>, never matches keys outside the metrics: block
_read_metrics_config() {
  local key="$1"
  local default="$2"
  if [[ ! -f "$HIVE_CONFIG" ]]; then
    echo "$default"
    return
  fi
  local val=""
  if command -v yq &>/dev/null; then
    val=$(yq ".metrics.${key}" "$HIVE_CONFIG" 2>/dev/null | tr -d ' "' || true)
  elif command -v python3 &>/dev/null; then
    val=$(python3 - "$HIVE_CONFIG" "$key" <<'PYEOF'
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
    val=$(awk '/^metrics:/{flag=1; next} /^[a-zA-Z]/{flag=0} flag && /^[[:space:]]+'"$key"':/' "$HIVE_CONFIG" \
      | head -1 | sed 's/[^:]*:[[:space:]]*//' | tr -d ' "')
  fi
  if [[ -z "${val:-}" ]] || [[ "$val" == "null" ]]; then
    echo "$default"
  else
    echo "$val"
  fi
}

metrics_enabled=$(_read_metrics_config "enabled" "false")
metrics_dir=$(_read_metrics_config "dir" ".pHive/metrics")

# Strip leading/trailing whitespace
metrics_enabled=$(echo "$metrics_enabled" | awk '{print $1}')
metrics_dir=$(echo "$metrics_dir" | awk '{print $1}')

# Silent no-op when metrics are disabled
if [[ "$metrics_enabled" != "true" ]]; then
  exit 0
fi

# Validate required env vars
run_id="${HIVE_RUN_ID:-}"
story_id="${HIVE_STORY_ID:-}"
proposal_id="${HIVE_PROPOSAL_ID:-}"
agent_name="${HIVE_AGENT:-}"

if [[ -z "$run_id" ]]; then
  echo "metrics-agent-spawn: HIVE_RUN_ID is required" >&2
  exit 1
fi
if [[ -z "$story_id" && -z "$proposal_id" ]]; then
  echo "metrics-agent-spawn: one of HIVE_STORY_ID or HIVE_PROPOSAL_ID is required" >&2
  exit 1
fi
if [[ -z "$agent_name" ]]; then
  echo "metrics-agent-spawn: HIVE_AGENT is required" >&2
  exit 1
fi

# Optional fields
swarm_id="${HIVE_SWARM_ID:-}"
phase="${HIVE_PHASE:-}"

# Build event_id using PID + RANDOM for same-second uniqueness (I-2)
# macOS date does not support %N; PID+RANDOM gives sufficient uniqueness
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
event_id="evt_${timestamp}_$$_${RANDOM}_spawn_${agent_name}"

# Build event JSON via jq for safe escaping of all user-supplied values
jq_filter='
  {
    event_id:    $event_id,
    timestamp:   $timestamp,
    run_id:      $run_id,
    metric_type: "wall_clock_ms",
    value:       0,
    unit:        "ms",
    agent:       $agent_name,
    dimensions:  {kind: "spawn_marker"},
    source:      "agent-spawn-report"
  }
  | if $story_id    != "" then . + {story_id:    $story_id}    else . end
  | if $proposal_id != "" then . + {proposal_id: $proposal_id} else . end
  | if $swarm_id    != "" then . + {swarm_id:    $swarm_id}    else . end
  | if $phase       != "" then . + {phase:       $phase}       else . end
'

event_row=$(jq -cn \
  --arg event_id    "$event_id" \
  --arg timestamp   "$timestamp" \
  --arg run_id      "$run_id" \
  --arg story_id    "$story_id" \
  --arg proposal_id "$proposal_id" \
  --arg swarm_id    "$swarm_id" \
  --arg phase       "$phase" \
  --arg agent_name  "$agent_name" \
  "$jq_filter")

# Ensure events directory exists and write
if [[ "$metrics_dir" != /* ]]; then
  metrics_dir="$HIVE_ROOT/$metrics_dir"
fi
events_dir="${metrics_dir}/events"
mkdir -p "$events_dir"

# Append to a per-run JSONL file so spawn events group with other run events
out_file="${events_dir}/${run_id}-spawn.jsonl"
echo "$event_row" >> "$out_file"
