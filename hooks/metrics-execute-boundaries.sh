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

HIVE_CONFIG="${HIVE_CONFIG:-hive/hive.config.yaml}"

# Parse metrics.enabled and metrics.dir from hive.config.yaml
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
if [[ -z "$fix_iterations" ]]; then
  echo "metrics-execute-boundaries: HIVE_FIX_ITERATIONS is required" >&2
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

# Optional fields
swarm_id="${HIVE_SWARM_ID:-}"
agent_name="${HIVE_AGENT:-}"
phase="${HIVE_PHASE:-}"

# Shared timestamp for both events in this boundary emission
timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Use nanoseconds for uniqueness when available
ns=$(date -u +"%N" 2>/dev/null || echo "0000")

# Build identity block (story_id XOR proposal_id)
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

# Build optional agent field
if [[ -n "$agent_name" ]]; then
  agent_field="\"agent\":\"${agent_name}\","
else
  agent_field=""
fi

# Build optional phase field
if [[ -n "$phase" ]]; then
  phase_field="\"phase\":\"${phase}\","
else
  phase_field=""
fi

# Ensure events directory exists
events_dir="${metrics_dir}/events"
mkdir -p "$events_dir"

# Output file groups both boundary events with the run
out_file="${events_dir}/${run_id}-execute-boundaries.jsonl"

# --- Event 1: fix_loop_iterations ---
# Emit the count of corrective fix-loop passes for this story/proposal attempt.
event_id_1="evt_${timestamp}_fix-loop_${ns}"
fix_dims="\"stage\":\"execute-boundary\""
if [[ -n "$phase" ]]; then
  fix_dims="${fix_dims},\"phase\":\"${phase}\""
fi
event_fix="{\"event_id\":\"${event_id_1}\",\"timestamp\":\"${timestamp}\",\"run_id\":\"${run_id}\",${swarm_field}${identity_field},${phase_field}${agent_field}\"metric_type\":\"fix_loop_iterations\",\"value\":${fix_iterations},\"unit\":\"iterations\",\"dimensions\":{${fix_dims}},\"source\":\"execute-phase-boundary\"}"
echo "$event_fix" >> "$out_file"

# --- Event 2: first_attempt_pass ---
# Emit an explicit binary signal: true = passed on first attempt, false = fix-loop was needed.
# Nanosecond suffix is incremented by 1 to guarantee uniqueness within the same second.
ns2=$((10#${ns} + 1))
ns2_padded=$(printf "%09d" "$ns2")
event_id_2="evt_${timestamp}_first-pass_${ns2_padded}"
pass_dims="\"stage\":\"execute-boundary\""
if [[ -n "$phase" ]]; then
  pass_dims="${pass_dims},\"phase\":\"${phase}\""
fi
event_pass="{\"event_id\":\"${event_id_2}\",\"timestamp\":\"${timestamp}\",\"run_id\":\"${run_id}\",${swarm_field}${identity_field},${phase_field}${agent_field}\"metric_type\":\"first_attempt_pass\",\"value\":${first_pass},\"unit\":\"bool\",\"dimensions\":{${pass_dims}},\"source\":\"execute-phase-boundary\"}"
echo "$event_pass" >> "$out_file"
