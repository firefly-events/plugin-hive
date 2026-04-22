#!/usr/bin/env bash
# metrics-execute-boundaries.sh — emit fix-loop-iteration and first-attempt-pass events
# at execute-phase boundaries when metrics are enabled.
#
# Call from an execute-boundary entrypoint with env vars set:
#   HIVE_RUN_ID           — required; groups all events in this run
#   HIVE_STORY_ID         — required when scoped to a story (mutually exclusive with HIVE_PROPOSAL_ID)
#   HIVE_PROPOSAL_ID      — required when scoped to a proposal (mutually exclusive with HIVE_STORY_ID)
#   HIVE_SWARM_ID         — optional; identifies the parent swarm
#   HIVE_AGENT            — optional; the agent at the boundary (e.g. "reviewer")
#   HIVE_PHASE            — optional; lifecycle phase at boundary (e.g. "review")
#   HIVE_FIX_ITERATIONS   — required; integer count of fix-loop iterations completed (0 = first pass)
#   HIVE_FIRST_PASS       — required; "true" or "false" — whether this was a first-attempt pass
#   HIVE_CONFIG           — optional; path to hive.config.yaml (default: hive/hive.config.yaml)
#
# Exit codes:
#   0 — events emitted (or metrics disabled — silent no-op)
#   1 — argument/config error

set -euo pipefail

# Resolve config path anchored to HIVE_ROOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_ROOT="${HIVE_ROOT:-$(dirname "$SCRIPT_DIR")}"
HIVE_CONFIG="${HIVE_CONFIG:-$HIVE_ROOT/hive/hive.config.yaml}"

# Three-tier YAML-scoped config reader: yq → python3 yaml.safe_load → awk-scoped grep
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
    if ! val=$(python3 - "$HIVE_CONFIG" "$key" <<'PYEOF'
import sys
try:
    import yaml
except ModuleNotFoundError:
    sys.exit(1)

try:
    with open(sys.argv[1]) as f:
        c = yaml.safe_load(f)
    v = c.get('metrics', {}).get(sys.argv[2], '')
    if v is not None and str(v) != '':
        print(str(v).lower() if isinstance(v, bool) else str(v))
except Exception:
    pass
PYEOF
    ); then
      val=""
    fi
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

_validate_safe_run_id() {
  local candidate="$1"
  if [[ "$candidate" == *"/"* ]] || [[ "$candidate" == *"\\"* ]] || [[ "$candidate" == *".."* ]]; then
    echo "metrics-execute-boundaries: invalid run_id: path separators and traversal are not allowed" >&2
    exit 1
  fi
  if [[ ! "$candidate" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "metrics-execute-boundaries: invalid run_id: only [A-Za-z0-9._-] are allowed" >&2
    exit 1
  fi
}

# Validate required env vars
run_id="${HIVE_RUN_ID:-}"
story_id="${HIVE_STORY_ID:-}"
proposal_id="${HIVE_PROPOSAL_ID:-}"
fix_iterations="${HIVE_FIX_ITERATIONS:-}"
first_pass="${HIVE_FIRST_PASS:-}"

if [[ -z "$run_id" ]]; then
  echo "metrics-execute-boundaries: HIVE_RUN_ID is required" >&2
  exit 1
fi
if [[ -z "$story_id" && -z "$proposal_id" ]]; then
  echo "metrics-execute-boundaries: one of HIVE_STORY_ID or HIVE_PROPOSAL_ID is required" >&2
  exit 1
fi
if [[ -n "$story_id" && -n "$proposal_id" ]]; then
  echo "metrics-execute-boundaries: HIVE_STORY_ID and HIVE_PROPOSAL_ID are mutually exclusive" >&2
  exit 1
fi
if [[ -z "$fix_iterations" ]]; then
  echo "metrics-execute-boundaries: HIVE_FIX_ITERATIONS is required" >&2
  exit 1
fi
if ! [[ "$fix_iterations" =~ ^[0-9]+$ ]]; then
  echo "metrics-execute-boundaries: HIVE_FIX_ITERATIONS must be a non-negative integer" >&2
  exit 1
fi
if [[ -z "$first_pass" ]]; then
  echo "metrics-execute-boundaries: HIVE_FIRST_PASS is required (true or false)" >&2
  exit 1
fi

# Normalise first_pass to lowercase boolean string
first_pass=$(echo "$first_pass" | tr '[:upper:]' '[:lower:]')
if [[ "$first_pass" != "true" && "$first_pass" != "false" ]]; then
  echo "metrics-execute-boundaries: HIVE_FIRST_PASS must be 'true' or 'false'" >&2
  exit 1
fi
_validate_safe_run_id "$run_id"

# Optional fields
swarm_id="${HIVE_SWARM_ID:-}"
agent_name="${HIVE_AGENT:-}"
phase="${HIVE_PHASE:-}"

# Shared timestamp for both events in this boundary emission
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Ensure events directory exists (anchor relative metrics_dir to HIVE_ROOT)
if [[ "$metrics_dir" != /* ]]; then
  metrics_dir="$HIVE_ROOT/$metrics_dir"
fi
events_dir="${metrics_dir}/events"
mkdir -p "$events_dir"

# Output file groups both boundary events with the run
out_file="${events_dir}/${run_id}-execute-boundaries.jsonl"

# --- Event 1: fix_loop_iterations ---
# Emit the count of corrective fix-loop passes for this story/proposal attempt.
event_id_1="evt_${timestamp}_$$_${RANDOM}_fix_loop"

fix_jq_filter='
  {
    event_id:    $event_id,
    timestamp:   $timestamp,
    run_id:      $run_id,
    metric_type: "fix_loop_iterations",
    value:       ($fix_iterations | tonumber),
    unit:        "iterations",
    dimensions:  ({stage: "execute-boundary"} | if $phase != "" then . + {phase: $phase} else . end),
    source:      "execute-phase-boundary"
  }
  | if $story_id    != "" then . + {story_id:    $story_id}    else . end
  | if $proposal_id != "" then . + {proposal_id: $proposal_id} else . end
  | if $swarm_id    != "" then . + {swarm_id:    $swarm_id}    else . end
  | if $phase       != "" then . + {phase:       $phase}       else . end
  | if $agent_name  != "" then . + {agent:       $agent_name}  else . end
'

event_fix=$(jq -cn \
  --arg event_id      "$event_id_1" \
  --arg timestamp     "$timestamp" \
  --arg run_id        "$run_id" \
  --arg story_id      "$story_id" \
  --arg proposal_id   "$proposal_id" \
  --arg swarm_id      "$swarm_id" \
  --arg phase         "$phase" \
  --arg agent_name    "$agent_name" \
  --arg fix_iterations "$fix_iterations" \
  "$fix_jq_filter")
echo "$event_fix" >> "$out_file"

# --- Event 2: first_attempt_pass ---
# Emit an explicit binary signal: true = passed on first attempt, false = fix-loop was needed.
event_id_2="evt_${timestamp}_$$_${RANDOM}_first_pass"

pass_jq_filter='
  {
    event_id:    $event_id,
    timestamp:   $timestamp,
    run_id:      $run_id,
    metric_type: "first_attempt_pass",
    value:       ($first_pass == "true"),
    unit:        "bool",
    dimensions:  ({stage: "execute-boundary"} | if $phase != "" then . + {phase: $phase} else . end),
    source:      "execute-phase-boundary"
  }
  | if $story_id    != "" then . + {story_id:    $story_id}    else . end
  | if $proposal_id != "" then . + {proposal_id: $proposal_id} else . end
  | if $swarm_id    != "" then . + {swarm_id:    $swarm_id}    else . end
  | if $phase       != "" then . + {phase:       $phase}       else . end
  | if $agent_name  != "" then . + {agent:       $agent_name}  else . end
'

event_pass=$(jq -cn \
  --arg event_id    "$event_id_2" \
  --arg timestamp   "$timestamp" \
  --arg run_id      "$run_id" \
  --arg story_id    "$story_id" \
  --arg proposal_id "$proposal_id" \
  --arg swarm_id    "$swarm_id" \
  --arg phase       "$phase" \
  --arg agent_name  "$agent_name" \
  --arg first_pass  "$first_pass" \
  "$pass_jq_filter")
echo "$event_pass" >> "$out_file"
