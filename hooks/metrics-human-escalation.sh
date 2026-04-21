#!/usr/bin/env bash
# metrics-human-escalation.sh — emit a human_escalation event to .pHive/metrics/events/
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
CONFIG_FILE="$HIVE_ROOT/hive/hive.config.yaml"

# --- read gate ---------------------------------------------------------------
metrics_enabled="false"
metrics_dir=".pHive/metrics"

if [[ -f "$CONFIG_FILE" ]]; then
  val=$(grep -E '^[[:space:]]*enabled:' "$CONFIG_FILE" | head -1 | sed 's/[^:]*:[[:space:]]*//' | tr -d ' "')
  [[ "$val" == "true" ]] && metrics_enabled="true"
  dir_val=$(grep -E '^[[:space:]]*dir:' "$CONFIG_FILE" | head -1 | sed 's/[^:]*:[[:space:]]*//' | tr -d ' "')
  [[ -n "$dir_val" ]] && metrics_dir="$dir_val"
fi

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
event_id="evt_${timestamp}_human_escalation"

# correlation context field: story_id XOR proposal_id
if [[ -n "$story_id" ]]; then
  context_field="\"story_id\":\"$story_id\""
else
  context_field="\"proposal_id\":\"$proposal_id\""
fi

# optional fields
optional_fields=""
[[ -n "$swarm_id" ]]    && optional_fields="${optional_fields},\"swarm_id\":\"$swarm_id\""
[[ -n "$phase" ]]       && optional_fields="${optional_fields},\"phase\":\"$phase\""
[[ -n "$agent_name" ]]  && optional_fields="${optional_fields},\"agent\":\"$agent_name\""

# reason goes in dimensions
dim_reason=""
[[ -n "$reason" ]] && dim_reason="\"reason\":\"$reason\""
dimensions="{${dim_reason}}"

event="{\"event_id\":\"$event_id\",\"timestamp\":\"$timestamp\",\"run_id\":\"$run_id\"${optional_fields},${context_field},\"metric_type\":\"human_escalation\",\"value\":true,\"unit\":\"bool\",\"dimensions\":$dimensions,\"source\":\"orchestrator-escalation-path\"}"

# --- write -------------------------------------------------------------------
events_dir="$HIVE_ROOT/$metrics_dir/events"
mkdir -p "$events_dir"
printf '%s\n' "$event" >> "$events_dir/human-escalation.jsonl"
