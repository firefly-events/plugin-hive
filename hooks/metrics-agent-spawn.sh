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
#   HIVE_CONFIG       — optional; path to hive.config.yaml (default: ./hive.config.yaml)
#   HIVE_PRIOR_EXPERIENCE_INJECTED — optional; "true"/"false". Set ONLY when the caller
#     knows whether the memory-loading skill injected a Prior Knowledge block (warm) or
#     found nothing to inject (cold). CAVEAT: only the classic tmux Agent(name:) spawn
#     path (skills/hive/skills/agent-spawn/SKILL.md) sets this today — Hermes/multica-
#     dispatched respawns are cold by construction and do not set it yet. Omit rather
#     than guess.
#   HIVE_PRIOR_EXPERIENCE_COUNT — optional; non-negative integer. Number of prior-
#     knowledge memories injected (0 when HIVE_PRIOR_EXPERIENCE_INJECTED=false).
#     Ignored unless HIVE_PRIOR_EXPERIENCE_INJECTED is also set.
#
# Exit codes:
#   0 — event emitted (or metrics disabled — silent no-op)
#   1 — argument/config error

set -euo pipefail

# Resolve config path anchored to HIVE_ROOT
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"
HIVE_CONFIG="${HIVE_CONFIG:-$HIVE_ROOT/hive.config.yaml}"

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
  fi
  if [[ -z "${val:-}" ]] && command -v python3 &>/dev/null; then
    if ! val=$(python3 - "$HIVE_CONFIG" "$key" <<'PYEOF'
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
    ); then
      val=""
    fi
  fi
  if [[ -z "${val:-}" ]]; then
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
state_dir=$(_resolve_state_dir)

# Strip leading/trailing whitespace
metrics_enabled=$(echo "$metrics_enabled" | awk '{print $1}')

# Silent no-op when metrics are disabled
if [[ "$metrics_enabled" != "true" ]]; then
  exit 0
fi

_validate_safe_run_id() {
  local candidate="$1"
  if [[ "$candidate" == *"/"* ]] || [[ "$candidate" == *"\\"* ]] || [[ "$candidate" == *".."* ]]; then
    echo "metrics-agent-spawn: invalid run_id: path separators and traversal are not allowed" >&2
    exit 1
  fi
  if [[ ! "$candidate" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "metrics-agent-spawn: invalid run_id: only [A-Za-z0-9._-] are allowed" >&2
    exit 1
  fi
}

# Validate required env vars
run_id="${HIVE_RUN_ID:-}"
story_id="${HIVE_STORY_ID:-}"
proposal_id="${HIVE_PROPOSAL_ID:-}"
agent_name="${HIVE_AGENT:-}"

if [[ -z "$run_id" ]]; then
  echo "metrics-agent-spawn: invalid run_id: HIVE_RUN_ID is required" >&2
  exit 1
fi
_validate_safe_run_id "$run_id"
if [[ -z "$story_id" && -z "$proposal_id" ]]; then
  echo "metrics-agent-spawn: invalid story_id/proposal_id: exactly one of HIVE_STORY_ID or HIVE_PROPOSAL_ID is required" >&2
  exit 1
fi
if [[ -n "$story_id" && -n "$proposal_id" ]]; then
  echo "metrics-agent-spawn: invalid story_id/proposal_id: HIVE_STORY_ID and HIVE_PROPOSAL_ID are mutually exclusive" >&2
  exit 1
fi
if [[ -z "$agent_name" ]]; then
  echo "metrics-agent-spawn: invalid agent_name: HIVE_AGENT is required" >&2
  exit 1
fi

# Optional fields
swarm_id="${HIVE_SWARM_ID:-}"
phase="${HIVE_PHASE:-}"
prior_experience_injected="${HIVE_PRIOR_EXPERIENCE_INJECTED:-}"
prior_experience_count="${HIVE_PRIOR_EXPERIENCE_COUNT:-}"

if [[ -n "$prior_experience_injected" ]]; then
  if [[ "$prior_experience_injected" != "true" && "$prior_experience_injected" != "false" ]]; then
    echo "metrics-agent-spawn: invalid HIVE_PRIOR_EXPERIENCE_INJECTED: must be 'true' or 'false'" >&2
    exit 1
  fi
  prior_experience_count="${prior_experience_count:-0}"
  if ! [[ "$prior_experience_count" =~ ^[0-9]+$ ]]; then
    echo "metrics-agent-spawn: invalid HIVE_PRIOR_EXPERIENCE_COUNT: must be a non-negative integer" >&2
    exit 1
  fi
  if [[ "$prior_experience_injected" == "false" && "$prior_experience_count" -gt 0 ]]; then
    echo "metrics-agent-spawn: invalid prior_experience pair: injected=false but count>0" >&2
    exit 1
  fi
  if [[ "$prior_experience_injected" == "true" && "$prior_experience_count" -eq 0 ]]; then
    echo "metrics-agent-spawn: invalid prior_experience pair: injected=true but count=0" >&2
    exit 1
  fi
fi

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
  | if $prior_injected != "" then
      .dimensions += {
        prior_experience_injected: ($prior_injected == "true"),
        prior_experience_count: ($prior_count | tonumber)
      }
    else . end
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
  --arg prior_injected "$prior_experience_injected" \
  --arg prior_count    "${prior_experience_count:-0}" \
  "$jq_filter")

# Ensure events directory exists and write
metrics_dir="$state_dir/metrics"
events_dir="${metrics_dir}/events"
mkdir -p "$events_dir"

# Append to a per-run JSONL file so spawn events group with other run events
out_file="${events_dir}/${run_id}-spawn.jsonl"
echo "$event_row" >> "$out_file"
