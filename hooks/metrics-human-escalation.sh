#!/usr/bin/env bash
# metrics-human-escalation.sh — emit a human_escalation event to the metrics events directory
#
# Usage:
#   metrics-human-escalation.sh \
#     --run-id   <run_id>    \
#     --story-id <story_id>  \   # mutually exclusive with --proposal-id
#     --proposal-id <id>     \   # mutually exclusive with --story-id
#     [--swarm-id <swarm_id>]    \
#     [--phase <phase>]          \
#     [--agent <agent>]          \
#     [--reason <reason>]
#
# Reads metrics.enabled and metrics.dir from hive.config.yaml (resolved relative
# to HIVE_ROOT, defaulting to the directory containing this script's parent).
# Silent no-op when metrics.enabled is false or missing.

set -euo pipefail

# --- locate config -----------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_ROOT="${HIVE_ROOT:-$(dirname "$SCRIPT_DIR")}"
. "$HIVE_ROOT/hooks/common.sh"
CONFIG_FILE="${CONFIG_FILE:-$HIVE_ROOT/hive.config.yaml}"

# --- read gate ---------------------------------------------------------------
_read_metrics_config() {
  local key="$1"
  local default="$2"
  if [[ ! -f "$CONFIG_FILE" ]]; then
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
  if [[ -z "${val:-}" ]] || [[ "$val" == "null" ]] || [[ "$val" == "None" ]]; then
    echo "$default"
  else
    echo "$val"
  fi
}

metrics_enabled=$(_read_metrics_config "enabled" "false")
state_dir=$(_resolve_state_dir)
metrics_enabled=$(echo "$metrics_enabled" | awk '{print $1}')
state_dir=$(echo "$state_dir" | awk '{print $1}')

# silent no-op when disabled
if [[ "$metrics_enabled" != "true" ]]; then
  exit 0
fi

# --- parse args --------------------------------------------------------------
run_id=""
story_id=""
proposal_id=""
swarm_id=""
phase=""
agent_name=""
reason=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)      run_id="$2";      shift 2 ;;
    --story-id)    story_id="$2";    shift 2 ;;
    --proposal-id) proposal_id="$2"; shift 2 ;;
    --swarm-id)    swarm_id="$2";    shift 2 ;;
    --phase)       phase="$2";       shift 2 ;;
    --agent)       agent_name="$2";  shift 2 ;;
    --reason)      reason="$2";      shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# --- validate required args --------------------------------------------------
if [[ -z "$run_id" ]]; then
  echo "metrics-human-escalation: --run-id is required" >&2
  exit 1
fi
if [[ -z "$story_id" && -z "$proposal_id" ]]; then
  echo "metrics-human-escalation: one of --story-id or --proposal-id is required" >&2
  exit 1
fi
if [[ -n "$story_id" && -n "$proposal_id" ]]; then
  echo "metrics-human-escalation: --story-id and --proposal-id are mutually exclusive" >&2
  exit 1
fi

# --- build event -------------------------------------------------------------
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Append PID and RANDOM to guarantee uniqueness even for same-second emissions.
event_id="evt_${timestamp}_$$_${RANDOM}_human_escalation"

# Build the event JSON via jq for automatic escaping of all user-supplied values.
# Using --args + $ARGS.positional avoids any injection from field values.
jq_filter='
  . as $pos |
  {
    event_id:    $event_id,
    timestamp:   $timestamp,
    run_id:      $run_id,
    metric_type: "human_escalation",
    value:       true,
    unit:        "bool",
    source:      "orchestrator-escalation-path"
  }
  | if $story_id    != "" then . + {story_id:    $story_id}    else . end
  | if $proposal_id != "" then . + {proposal_id: $proposal_id} else . end
  | if $swarm_id    != "" then . + {swarm_id:    $swarm_id}    else . end
  | if $phase       != "" then . + {phase:       $phase}       else . end
  | if $agent_name  != "" then . + {agent:       $agent_name}  else . end
  | . + {dimensions: (if $reason != "" then {reason: $reason} else {} end)}
'

event=$(jq -cn \
  --arg event_id    "$event_id" \
  --arg timestamp   "$timestamp" \
  --arg run_id      "$run_id" \
  --arg story_id    "$story_id" \
  --arg proposal_id "$proposal_id" \
  --arg swarm_id    "$swarm_id" \
  --arg phase       "$phase" \
  --arg agent_name  "$agent_name" \
  --arg reason      "$reason" \
  "$jq_filter")

# --- write -------------------------------------------------------------------
if [[ "$state_dir" != /* ]]; then
  state_dir="$HIVE_ROOT/$state_dir"
fi
metrics_dir="$state_dir/metrics"
events_dir="${metrics_dir}/events"
mkdir -p "$events_dir"
printf '%s\n' "$event" >> "$events_dir/human-escalation.jsonl"
