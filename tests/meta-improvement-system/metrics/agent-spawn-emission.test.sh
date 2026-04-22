#!/usr/bin/env bash
# agent-spawn-emission.test.sh — C2.4 acceptance tests for metrics-agent-spawn.sh
#
# Tests:
#   (a) metrics.enabled: false  → no event file written
#   (b) metrics.enabled: true   → schema-valid JSONL event written
#   (c) emitted event carries run/story/spawn correlation fields
#   (d) proposal_id path: story_id absent when proposal_id supplied
#   (e) YAML-scope: metrics.enabled: false + later enabled: true → no emission
#   (f) dimensions.kind = spawn_marker; no dimensions.phase or dimensions.agent_persona
#   (g) event_id uniqueness: two rapid emissions produce distinct event_ids

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/hooks/metrics-agent-spawn.sh"

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED+1)); echo "[PASS] $1"; }
fail() { FAILED=$((FAILED+1)); echo "[FAIL] $1"; }

# Setup: create isolated temp workspace
TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

make_config() {
  local dir="$1"
  local enabled="$2"
  local metrics_dir="${3:-$dir/metrics}"
  mkdir -p "$dir/hive"
  cat > "$dir/hive/hive.config.yaml" <<EOF
metrics:
  enabled: $enabled
  dir: $metrics_dir
EOF
}

# ---------------------------------------------------------------------------
# (a) flag-off → no write
# ---------------------------------------------------------------------------
echo "=== (a) metrics.enabled: false → no event written ==="

WDIR_A="$TMPDIR_BASE/a"
mkdir -p "$WDIR_A"
make_config "$WDIR_A" "false"

(
  HIVE_ROOT="$WDIR_A" \
  HIVE_RUN_ID="run_test_2026-04-21_001" \
  HIVE_STORY_ID="C2.4" \
  HIVE_AGENT="developer" \
  bash "$HELPER"
)

events_a="$WDIR_A/metrics/events"
if [[ -d "$events_a" ]] && compgen -G "$events_a/*.jsonl" >/dev/null 2>&1; then
  fail "flag-off: event file written when metrics disabled"
else
  pass "flag-off: no event file written"
fi

# ---------------------------------------------------------------------------
# (b) flag-on → schema-valid JSONL event written
# ---------------------------------------------------------------------------
echo ""
echo "=== (b) metrics.enabled: true → schema-valid event written ==="

WDIR_B="$TMPDIR_BASE/b"
mkdir -p "$WDIR_B"
make_config "$WDIR_B" "true" "$WDIR_B/metrics"

(
  cd "$WDIR_B"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_001" \
  HIVE_STORY_ID="C2.4" \
  HIVE_SWARM_ID="meta-meta-optimize" \
  HIVE_AGENT="developer" \
  HIVE_PHASE="implement" \
  bash "$HELPER"
)

events_b="$WDIR_B/metrics/events"
jsonl_files=()
if [[ -d "$events_b" ]]; then
  while IFS= read -r -d '' f; do
    jsonl_files+=("$f")
  done < <(find "$events_b" -name "*.jsonl" -print0 2>/dev/null)
fi

if [[ ${#jsonl_files[@]} -eq 0 ]]; then
  fail "flag-on: no event file created"
else
  pass "flag-on: event file created"

  # Validate the event row is parseable JSON
  event_file="${jsonl_files[0]}"
  first_line=$(head -1 "$event_file")

  if python3 -c "import json,sys; json.loads(sys.argv[1])" "$first_line" 2>/dev/null; then
    pass "flag-on: event row is valid JSON"
  else
    fail "flag-on: event row is NOT valid JSON"
  fi

  # Validate required schema fields are present (schema §7)
  required_fields=("event_id" "timestamp" "run_id" "metric_type" "value" "unit" "dimensions" "source")
  all_required=true
  for field in "${required_fields[@]}"; do
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert '$field' in d" "$first_line" 2>/dev/null; then
      pass "flag-on: field '$field' present"
    else
      fail "flag-on: field '$field' MISSING"
      all_required=false
    fi
  done

  # Validate source = agent-spawn-report (schema §3.13 example)
  if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['source']=='agent-spawn-report'" "$first_line" 2>/dev/null; then
    pass "flag-on: source = 'agent-spawn-report'"
  else
    fail "flag-on: source != 'agent-spawn-report'"
  fi

  # Validate metric_type is from MVP registry (schema §4)
  valid_types='["tokens","wall_clock_ms","fix_loop_iterations","first_attempt_pass","human_escalation"]'
  if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['metric_type'] in $valid_types" "$first_line" 2>/dev/null; then
    pass "flag-on: metric_type is a valid registry value"
  else
    fail "flag-on: metric_type not in MVP registry"
  fi

  # Validate exactly one of story_id / proposal_id (schema §7)
  if python3 -c "
import json,sys
d=json.loads(sys.argv[1])
has_story = 'story_id' in d
has_proposal = 'proposal_id' in d
assert has_story != has_proposal, 'must have exactly one of story_id or proposal_id'
" "$first_line" 2>/dev/null; then
    pass "flag-on: exactly one of story_id/proposal_id present"
  else
    fail "flag-on: story_id/proposal_id invariant violated"
  fi
fi

# ---------------------------------------------------------------------------
# (c) correlation fields: run_id, story_id, agent, swarm_id carried in event
# ---------------------------------------------------------------------------
echo ""
echo "=== (c) event carries run/story/spawn correlation fields ==="

if [[ ${#jsonl_files[@]} -gt 0 ]]; then
  event_file="${jsonl_files[0]}"
  first_line=$(head -1 "$event_file")

  check_field_value() {
    local field="$1"
    local expected="$2"
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get('$field')==sys.argv[2]" "$first_line" "$expected" 2>/dev/null; then
      pass "correlation: $field = '$expected'"
    else
      fail "correlation: $field != '$expected'"
    fi
  }

  check_field_value "run_id"   "run_test_2026-04-21_001"
  check_field_value "story_id" "C2.4"
  check_field_value "agent"    "developer"
  check_field_value "swarm_id" "meta-meta-optimize"
  check_field_value "phase"    "implement"

else
  fail "correlation tests skipped: no event file from (b)"
fi

# ---------------------------------------------------------------------------
# (d) proposal_id path: story_id absent when proposal_id supplied
# ---------------------------------------------------------------------------
echo ""
echo "=== (d) proposal_id path: story_id absent ==="

WDIR_D="$TMPDIR_BASE/d"
mkdir -p "$WDIR_D"
make_config "$WDIR_D" "true" "$WDIR_D/metrics"

(
  cd "$WDIR_D"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_002" \
  HIVE_PROPOSAL_ID="backlog-017" \
  HIVE_AGENT="architect" \
  bash "$HELPER"
)

events_d=()
while IFS= read -r -d '' f; do
  events_d+=("$f")
done < <(find "$WDIR_D/metrics/events" -name "*.jsonl" -print0 2>/dev/null)

if [[ ${#events_d[@]} -gt 0 ]]; then
  first_d=$(head -1 "${events_d[0]}")
  if python3 -c "
import json,sys
d=json.loads(sys.argv[1])
assert 'proposal_id' in d
assert 'story_id' not in d
" "$first_d" 2>/dev/null; then
    pass "proposal_id path: proposal_id present, story_id absent"
  else
    fail "proposal_id path: field invariant violated"
  fi
else
  fail "proposal_id path: no event file written"
fi

# ---------------------------------------------------------------------------
# (e) YAML-scope: metrics.enabled: false + later block with enabled: true → no emission
# ---------------------------------------------------------------------------
echo ""
echo "=== (e) YAML-scope collision: metrics.enabled: false + later enabled: true → no write ==="

WDIR_E="$TMPDIR_BASE/e"
mkdir -p "$WDIR_E/hive"
# metrics block has enabled: false; a later unrelated block has enabled: true
cat > "$WDIR_E/hive/hive.config.yaml" <<'EOF'
metrics:
  enabled: false
  dir: .pHive/metrics
other_feature:
  enabled: true
EOF

(
  cd "$WDIR_E"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_scope" \
  HIVE_STORY_ID="C2.4" \
  HIVE_AGENT="developer" \
  bash "$HELPER"
)

events_e="$WDIR_E/.pHive/metrics/events"
if [[ -d "$events_e" ]] && compgen -G "$events_e/*.jsonl" >/dev/null 2>&1; then
  fail "yaml-scope: event written when metrics.enabled is false (other block's true matched)"
else
  pass "yaml-scope: no event written; metrics block correctly scoped"
fi

# ---------------------------------------------------------------------------
# (f) dimensions.kind = spawn_marker; dimensions.phase and dimensions.agent_persona absent
# ---------------------------------------------------------------------------
echo ""
echo "=== (f) dimensions: kind=spawn_marker; no phase/agent_persona in dimensions ==="

if [[ ${#jsonl_files[@]} -gt 0 ]]; then
  first_line=$(head -1 "${jsonl_files[0]}")

  if python3 -c "
import json,sys
d=json.loads(sys.argv[1])
dims=d.get('dimensions',{})
assert dims.get('kind')=='spawn_marker', f'kind={dims.get(\"kind\")}'
assert 'phase' not in dims, 'dimensions.phase must not be present'
assert 'agent_persona' not in dims, 'dimensions.agent_persona must not be present'
" "$first_line" 2>/dev/null; then
    pass "dimensions: kind=spawn_marker, no phase/agent_persona in dimensions"
  else
    fail "dimensions: invariant violated — check kind, phase, agent_persona"
  fi

  # Top-level phase and agent must still be present
  if python3 -c "
import json,sys
d=json.loads(sys.argv[1])
assert 'agent' in d, 'top-level agent missing'
assert 'phase' in d, 'top-level phase missing'
" "$first_line" 2>/dev/null; then
    pass "dimensions: top-level agent and phase present"
  else
    fail "dimensions: top-level agent or phase missing"
  fi
else
  fail "(f) skipped: no event file from (b)"
fi

# ---------------------------------------------------------------------------
# (g) event_id uniqueness: two rapid emissions produce distinct event_ids
# ---------------------------------------------------------------------------
echo ""
echo "=== (g) event_id uniqueness: two rapid same-second emissions ==="

WDIR_G="$TMPDIR_BASE/g"
mkdir -p "$WDIR_G"
make_config "$WDIR_G" "true" "$WDIR_G/metrics"

(
  cd "$WDIR_G"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_uniq" \
  HIVE_STORY_ID="C2.4" \
  HIVE_AGENT="developer" \
  bash "$HELPER"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_uniq" \
  HIVE_STORY_ID="C2.4" \
  HIVE_AGENT="developer" \
  bash "$HELPER"
)

out_g="$WDIR_G/metrics/events/run_test_2026-04-21_uniq-spawn.jsonl"
if [[ -f "$out_g" ]]; then
  id1=$(python3 -c "import json; lines=open('$out_g').readlines(); print(json.loads(lines[0])['event_id'])" 2>/dev/null || echo "")
  id2=$(python3 -c "import json; lines=open('$out_g').readlines(); print(json.loads(lines[1])['event_id'])" 2>/dev/null || echo "")
  if [[ -n "$id1" && -n "$id2" && "$id1" != "$id2" ]]; then
    pass "event_id uniqueness: two rapid emissions produced distinct IDs"
  else
    fail "event_id uniqueness: IDs were identical or missing ($id1 / $id2)"
  fi
else
  fail "event_id uniqueness: spawn file not created"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Result: $PASSED passed, $FAILED failed ==="
[[ $FAILED -eq 0 ]] || exit 1
