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

# Resolve config path
HIVE_CONFIG="${HIVE_CONFIG:-hive/hive.config.yaml}"

# Parse metrics.enabled and metrics.dir from hive.config.yaml
# yq is not guaranteed; use pure bash/python fallback
if command -v yq >/dev/null 2>&1; then
  metrics_enabled=$(yq '.metrics.enabled' "$HIVE_CONFIG" 2>/dev/null || echo "false")
  metrics_dir=$(yq '.metrics.dir' "$HIVE_CONFIG" 2>/dev/null || echo ".pHive/metrics")
elif command -v python3 >/dev/null 2>&1; then
  metrics_enabled=$(python3 - "$HIVE_CONFIG" <<'EOF'
import sys, re
path = sys.argv[1]
try:
    text = open(path).read()
    m = re.search(r'^\s*enabled:\s*(true|false)', text, re.MULTILINE)
    print(m.group(1) if m else "false")
except Exception:
    print("false")
EOF
)
  metrics_dir=$(python3 - "$HIVE_CONFIG" <<'EOF'
import sys, re
path = sys.argv[1]
try:
    text = open(path).read()
    m = re.search(r'^\s*dir:\s*(\S+)', text, re.MULTILINE)
    print(m.group(1) if m else ".pHive/metrics")
except Exception:
    print(".pHive/metrics")
EOF
)
else
  # grep fallback: very basic
  metrics_enabled=$(grep -E '^\s*enabled:' "$HIVE_CONFIG" | head -1 | awk '{print $2}' || echo "false")
  metrics_dir=$(grep -E '^\s*dir:' "$HIVE_CONFIG" | head -1 | awk '{print $2}' || echo ".pHive/metrics")
fi

# Normalise: strip inline yaml comments and surrounding quotes
metrics_enabled="${metrics_enabled%%#*}"
metrics_enabled="${metrics_enabled//\"/}"
metrics_enabled="${metrics_enabled//\'/}"
metrics_enabled=$(echo "$metrics_enabled" | tr -d '[:space:]')

metrics_dir="${metrics_dir%%#*}"
metrics_dir="${metrics_dir//\"/}"
metrics_dir="${metrics_dir//\'/}"
metrics_dir=$(echo "$metrics_dir" | tr -d '[:space:]')

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

# Build event_id: evt_<timestamp>_spawn_<agent>
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Use nanoseconds for uniqueness when available; fall back to seconds
if date -u +"%N" >/dev/null 2>&1; then
  ns=$(date -u +"%N" 2>/dev/null || echo "0000")
else
  ns="0000"
fi
event_id="evt_${timestamp}_spawn_${agent_name}_${ns}"

# Build spawn-scoped dimensions: agent persona + phase if present
dimensions_pairs="\"agent_persona\":\"${agent_name}\""
if [[ -n "$phase" ]]; then
  dimensions_pairs="${dimensions_pairs},\"phase\":\"${phase}\""
fi

# Build the identity block (story_id XOR proposal_id)
if [[ -n "$story_id" ]]; then
  identity_field="\"story_id\":\"${story_id}\""
else
  identity_field="\"proposal_id\":\"${proposal_id}\""
fi

# Build optional swarm field
if [[ -n "$swarm_id" ]]; then
  swarm_field="\"swarm_id\":\"${swarm_id}\","
else
  swarm_field=""
fi

# Build optional phase field
if [[ -n "$phase" ]]; then
  phase_field="\"phase\":\"${phase}\","
else
  phase_field=""
fi

# Assemble JSONL row
event_row="{\"event_id\":\"${event_id}\",\"timestamp\":\"${timestamp}\",\"run_id\":\"${run_id}\",${swarm_field}${identity_field},${phase_field}\"agent\":\"${agent_name}\",\"metric_type\":\"wall_clock_ms\",\"value\":0,\"unit\":\"ms\",\"dimensions\":{${dimensions_pairs}},\"source\":\"agent-spawn-report\"}"

# Ensure events directory exists and write
events_dir="${metrics_dir}/events"
mkdir -p "$events_dir"

# Append to a per-run JSONL file so spawn events group with other run events
out_file="${events_dir}/${run_id}-spawn.jsonl"
echo "$event_row" >> "$out_file"
