#!/usr/bin/env bash
# execute-boundaries.test.sh — C2.5 acceptance tests for metrics-execute-boundaries.sh
#
# Tests:
#   (a) first-pass case: emits first_attempt_pass=true, fix_loop_iterations=0
#   (b) fix-loop case: emits first_attempt_pass=false, fix_loop_iterations>0
#   (c) flag-off silence: no events written when metrics.enabled: false
#   (d) event_id uniqueness: two rapid same-second emissions produce distinct event_ids

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/hooks/metrics-execute-boundaries.sh"

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED+1)); echo "[PASS] $1"; }
fail() { FAILED=$((FAILED+1)); echo "[FAIL] $1"; }

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
# (a) first-pass case: HIVE_FIRST_PASS=true, HIVE_FIX_ITERATIONS=0
# ---------------------------------------------------------------------------
echo "=== (a) first-pass case ==="

WDIR_A="$TMPDIR_BASE/a"
mkdir -p "$WDIR_A"
make_config "$WDIR_A" "true" "$WDIR_A/metrics"

(
  cd "$WDIR_A"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_001" \
  HIVE_STORY_ID="C2.5" \
  HIVE_SWARM_ID="meta-meta-optimize" \
  HIVE_AGENT="reviewer" \
  HIVE_PHASE="review" \
  HIVE_FIX_ITERATIONS="0" \
  HIVE_FIRST_PASS="true" \
  bash "$HELPER"
)

events_a=()
while IFS= read -r -d '' f; do
  events_a+=("$f")
done < <(find "$WDIR_A/metrics/events" -name "*.jsonl" -print0 2>/dev/null)

if [[ ${#events_a[@]} -eq 0 ]]; then
  fail "first-pass: no event file written"
else
  pass "first-pass: event file created"

  # Collect all lines (two events expected)
  all_lines=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && all_lines+=("$line")
  done < "${events_a[0]}"

  if [[ ${#all_lines[@]} -eq 2 ]]; then
    pass "first-pass: exactly 2 event rows emitted"
  else
    fail "first-pass: expected 2 rows, got ${#all_lines[@]}"
  fi

  # Validate both rows parse as JSON
  for i in 0 1; do
    if python3 -c "import json,sys; json.loads(sys.argv[1])" "${all_lines[$i]:-}" 2>/dev/null; then
      pass "first-pass: row $((i+1)) is valid JSON"
    else
      fail "first-pass: row $((i+1)) is NOT valid JSON"
    fi
  done

  # Find fix_loop_iterations row and first_attempt_pass row
  fix_row=""
  pass_row=""
  for line in "${all_lines[@]}"; do
    mt=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('metric_type',''))" "$line" 2>/dev/null || true)
    if [[ "$mt" == "fix_loop_iterations" ]]; then fix_row="$line"; fi
    if [[ "$mt" == "first_attempt_pass" ]]; then pass_row="$line"; fi
  done

  if [[ -n "$fix_row" ]]; then
    pass "first-pass: fix_loop_iterations event present"
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['value']==0" "$fix_row" 2>/dev/null; then
      pass "first-pass: fix_loop_iterations value=0"
    else
      fail "first-pass: fix_loop_iterations value != 0"
    fi
  else
    fail "first-pass: fix_loop_iterations event missing"
  fi

  if [[ -n "$pass_row" ]]; then
    pass "first-pass: first_attempt_pass event present"
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['value']==True" "$pass_row" 2>/dev/null; then
      pass "first-pass: first_attempt_pass value=true"
    else
      fail "first-pass: first_attempt_pass value != true"
    fi
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['unit']=='bool'" "$pass_row" 2>/dev/null; then
      pass "first-pass: first_attempt_pass unit=bool"
    else
      fail "first-pass: first_attempt_pass unit != 'bool'"
    fi
  else
    fail "first-pass: first_attempt_pass event missing"
  fi

  # Validate required schema fields on both rows
  required_fields=("event_id" "timestamp" "run_id" "metric_type" "value" "unit" "dimensions" "source")
  for row in "$fix_row" "$pass_row"; do
    [[ -z "$row" ]] && continue
    for field in "${required_fields[@]}"; do
      if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert '$field' in d" "$row" 2>/dev/null; then
        pass "first-pass: field '$field' present in $(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('metric_type','?'))" "$row" 2>/dev/null)"
      else
        fail "first-pass: field '$field' MISSING from $(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('metric_type','?'))" "$row" 2>/dev/null)"
      fi
    done
  done

  # source must be execute-phase-boundary
  for row in "$fix_row" "$pass_row"; do
    [[ -z "$row" ]] && continue
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['source']=='execute-phase-boundary'" "$row" 2>/dev/null; then
      pass "first-pass: source='execute-phase-boundary' on $(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('metric_type','?'))" "$row" 2>/dev/null)"
    else
      fail "first-pass: source!='execute-phase-boundary' on $(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('metric_type','?'))" "$row" 2>/dev/null)"
    fi
  done

  # Validate event_ids are unique
  if [[ -n "$fix_row" && -n "$pass_row" ]]; then
    id1=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['event_id'])" "$fix_row" 2>/dev/null || echo "")
    id2=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['event_id'])" "$pass_row" 2>/dev/null || echo "")
    if [[ "$id1" != "$id2" && -n "$id1" && -n "$id2" ]]; then
      pass "first-pass: event_ids are unique"
    else
      fail "first-pass: event_id collision between the two rows"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# (b) fix-loop case: HIVE_FIRST_PASS=false, HIVE_FIX_ITERATIONS=2
# ---------------------------------------------------------------------------
echo ""
echo "=== (b) fix-loop case ==="

WDIR_B="$TMPDIR_BASE/b"
mkdir -p "$WDIR_B"
make_config "$WDIR_B" "true" "$WDIR_B/metrics"

(
  cd "$WDIR_B"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_002" \
  HIVE_STORY_ID="C2.5" \
  HIVE_SWARM_ID="meta-meta-optimize" \
  HIVE_AGENT="reviewer" \
  HIVE_PHASE="review" \
  HIVE_FIX_ITERATIONS="2" \
  HIVE_FIRST_PASS="false" \
  bash "$HELPER"
)

events_b=()
while IFS= read -r -d '' f; do
  events_b+=("$f")
done < <(find "$WDIR_B/metrics/events" -name "*.jsonl" -print0 2>/dev/null)

if [[ ${#events_b[@]} -eq 0 ]]; then
  fail "fix-loop: no event file written"
else
  pass "fix-loop: event file created"

  all_lines_b=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && all_lines_b+=("$line")
  done < "${events_b[0]}"

  fix_row_b=""
  pass_row_b=""
  for line in "${all_lines_b[@]}"; do
    mt=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('metric_type',''))" "$line" 2>/dev/null || true)
    if [[ "$mt" == "fix_loop_iterations" ]]; then fix_row_b="$line"; fi
    if [[ "$mt" == "first_attempt_pass" ]]; then pass_row_b="$line"; fi
  done

  if [[ -n "$fix_row_b" ]]; then
    pass "fix-loop: fix_loop_iterations event present"
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['value']==2" "$fix_row_b" 2>/dev/null; then
      pass "fix-loop: fix_loop_iterations value=2"
    else
      fail "fix-loop: fix_loop_iterations value != 2"
    fi
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['unit']=='iterations'" "$fix_row_b" 2>/dev/null; then
      pass "fix-loop: fix_loop_iterations unit=iterations"
    else
      fail "fix-loop: fix_loop_iterations unit != 'iterations'"
    fi
  else
    fail "fix-loop: fix_loop_iterations event missing"
  fi

  if [[ -n "$pass_row_b" ]]; then
    pass "fix-loop: first_attempt_pass event present"
    if python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d['value']==False" "$pass_row_b" 2>/dev/null; then
      pass "fix-loop: first_attempt_pass value=false (fix-loop needed)"
    else
      fail "fix-loop: first_attempt_pass value != false"
    fi
  else
    fail "fix-loop: first_attempt_pass event missing"
  fi

  # Binary distinguishability: the two cases must have opposite first_attempt_pass values
  if [[ ${#events_a[@]} -gt 0 && -n "$pass_row_b" ]]; then
    # pass_row from (a) has value=true; pass_row_b has value=false — already validated above
    pass "fix-loop: first_attempt_pass clearly distinguishes first-pass (true) from fix-loop (false)"
  fi
fi

# ---------------------------------------------------------------------------
# (c) flag-off silence: no events written when metrics.enabled: false
# ---------------------------------------------------------------------------
echo ""
echo "=== (c) flag-off silence ==="

WDIR_C="$TMPDIR_BASE/c"
mkdir -p "$WDIR_C"
make_config "$WDIR_C" "false"

(
  cd "$WDIR_C"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_003" \
  HIVE_STORY_ID="C2.5" \
  HIVE_FIX_ITERATIONS="1" \
  HIVE_FIRST_PASS="false" \
  bash "$HELPER"
)

events_c_dir="$WDIR_C/metrics/events"
if [[ -d "$events_c_dir" ]] && compgen -G "$events_c_dir/*.jsonl" >/dev/null 2>&1; then
  fail "flag-off: event file written when metrics disabled"
else
  pass "flag-off: no event file written"
fi

# Also verify exit code is 0 (silent no-op, not an error)
exit_code=0
(
  cd "$WDIR_C"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_003" \
  HIVE_STORY_ID="C2.5" \
  HIVE_FIX_ITERATIONS="1" \
  HIVE_FIRST_PASS="false" \
  bash "$HELPER"
) || exit_code=$?

if [[ $exit_code -eq 0 ]]; then
  pass "flag-off: exit code 0 (silent no-op)"
else
  fail "flag-off: non-zero exit code $exit_code when metrics disabled"
fi

# ---------------------------------------------------------------------------
# (d) event_id uniqueness: two rapid same-second emissions produce distinct event_ids
# ---------------------------------------------------------------------------
echo ""
echo "=== (d) event_id uniqueness: two rapid same-second emissions ==="

WDIR_D="$TMPDIR_BASE/d"
mkdir -p "$WDIR_D"
make_config "$WDIR_D" "true" "$WDIR_D/metrics"

(
  cd "$WDIR_D"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_uniq" \
  HIVE_STORY_ID="C2.5" \
  HIVE_FIX_ITERATIONS="0" \
  HIVE_FIRST_PASS="true" \
  bash "$HELPER"
  HIVE_CONFIG="hive/hive.config.yaml" \
  HIVE_RUN_ID="run_test_2026-04-21_uniq" \
  HIVE_STORY_ID="C2.5" \
  HIVE_FIX_ITERATIONS="0" \
  HIVE_FIRST_PASS="true" \
  bash "$HELPER"
)

out_d="$WDIR_D/metrics/events/run_test_2026-04-21_uniq-execute-boundaries.jsonl"
if [[ -f "$out_d" ]]; then
  all_ids=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    id=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['event_id'])" "$line" 2>/dev/null || echo "")
    all_ids+=("$id")
  done < "$out_d"

  if [[ ${#all_ids[@]} -eq 4 ]]; then
    pass "event_id uniqueness: 4 events written across 2 rapid emissions"
  else
    fail "event_id uniqueness: expected 4 events, got ${#all_ids[@]}"
  fi

  unique_count=$(printf "%s\n" "${all_ids[@]}" | sort -u | wc -l | tr -d ' ')
  if [[ "$unique_count" -eq 4 ]]; then
    pass "event_id uniqueness: all 4 event_ids are distinct"
  else
    fail "event_id uniqueness: only $unique_count distinct IDs out of 4 (collision detected)"
  fi
else
  fail "event_id uniqueness: execute-boundaries file not created"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "=== Result: $PASSED passed, $FAILED failed ==="
[[ $FAILED -eq 0 ]] || exit 1
