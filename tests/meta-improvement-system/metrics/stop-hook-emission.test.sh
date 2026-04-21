#!/bin/bash
# stop-hook-emission.test.sh — C2.2 Stop-hook metrics dispatcher tests
#
# Covers:
#  (a) flag-off  → no event write, sentinel preserved
#  (b) flag-on   → event written with required fields, sentinel preserved
#  (c) metrics script failure → sentinel still writes
#  (d) idempotency → second invocation appends a new row, does not overwrite

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/../../.." rev-parse --show-toplevel)"
DISPATCHER="$REPO_ROOT/hooks/metrics-stop-dispatch.sh"
PLUGIN_JSON="$REPO_ROOT/.claude-plugin/plugin.json"

PASS=0
FAIL=0
ERRORS=()

_pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
_fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }

# ── Fixture setup ────────────────────────────────────────────────────────────

TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

_make_fixture() {
  local name="$1"
  local enabled="$2"
  local dir="$TMPDIR_BASE/$name"
  mkdir -p "$dir/repo/hive" "$dir/repo/.pHive/interrupts" "$dir/repo/hooks"

  # Stub hive.config.yaml
  cat > "$dir/repo/hive/hive.config.yaml" <<YAML
metrics:
  enabled: $enabled
  dir: .pHive/metrics
YAML

  # Link dispatcher script
  cp "$DISPATCHER" "$dir/repo/hooks/metrics-stop-dispatch.sh"

  # Stub git so the script can find repo root
  mkdir -p "$dir/repo/.git"

  echo "$dir/repo"
}

_make_jsonl() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'JSONL'
{"type":"assistant","sessionId":"test-session-001","isSidechain":false,"timestamp":"2026-04-21T10:00:00Z","message":{"model":"claude-opus-4-7","usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":50,"cache_read_input_tokens":300}}}
{"type":"assistant","sessionId":"test-session-001","isSidechain":false,"timestamp":"2026-04-21T10:01:00Z","message":{"model":"claude-opus-4-7","usage":{"input_tokens":80,"output_tokens":150,"cache_creation_input_tokens":0,"cache_read_input_tokens":120}}}
{"type":"user","sessionId":"test-session-001","message":{"role":"user","content":"hello"}}
JSONL
}

_run_sentinel_command() {
  local repo="$1"
  # Reproduce the exact sentinel command from plugin.json
  (
    cd "$repo"
    ts=$(date -u +%Y-%m-%dT%H%M%SZ)
    mkdir -p .pHive/interrupts
    printf 'interrupted_at: "%s"\ninterruption_type: forced_stop\nactive_epic: null\nactive_story: null\nactive_step: null\n' "$ts" > ".pHive/interrupts/$ts.yaml"
  )
}

_run_dispatcher() {
  local repo="$1"
  local session_id="$2"
  local input_json
  input_json=$(jq -nc --arg sid "$session_id" --arg cwd "$repo" \
    '{session_id: $sid, cwd: $cwd, hook_event_name: "Stop"}')
  (
    cd "$repo"
    export HOME="$TMPDIR_BASE/fake_home_$RANDOM"
    # Pass HIVE_REPO_ROOT_OVERRIDE so script finds fixture config
    export HIVE_REPO_ROOT_OVERRIDE="$repo"
    echo "$input_json" | bash "$repo/hooks/metrics-stop-dispatch.sh"
  )
}

_run_dispatcher_with_transcript() {
  local repo="$1"
  local session_id="$2"
  local transcript_path="$3"
  local input_json
  # Pass transcript_path directly so dispatcher skips JSONL path resolution
  input_json=$(jq -nc --arg sid "$session_id" --arg cwd "$repo" --arg tp "$transcript_path" \
    '{session_id: $sid, cwd: $cwd, transcript_path: $tp, hook_event_name: "Stop"}')
  (
    cd "$repo"
    export HIVE_REPO_ROOT_OVERRIDE="$repo"
    echo "$input_json" | bash "$repo/hooks/metrics-stop-dispatch.sh"
  )
}

# ── Test (a): flag-off = no write, sentinel preserved ─────────────────────────

echo ""
echo "=== (a) flag-off: no write, sentinel preserved ==="

REPO_A=$(_make_fixture "flag_off" "false")

# Write sentinel
_run_sentinel_command "$REPO_A"
sentinel_count=$(ls "$REPO_A/.pHive/interrupts/" | wc -l | tr -d ' ')

# Run dispatcher (should no-op)
_run_dispatcher "$REPO_A" "test-session-a" 2>/dev/null

# Check no events written
if [ -d "$REPO_A/.pHive/metrics/events" ]; then
  event_files=$(ls "$REPO_A/.pHive/metrics/events/" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$event_files" -eq "0" ]; then
    _pass "flag-off: no events written"
  else
    _fail "flag-off: unexpected event files found ($event_files)"
  fi
else
  _pass "flag-off: events dir not created"
fi

# Sentinel count must not have changed (dispatcher runs after, doesn't affect it)
sentinel_count_after=$(ls "$REPO_A/.pHive/interrupts/" | wc -l | tr -d ' ')
if [ "$sentinel_count_after" -eq "$sentinel_count" ]; then
  _pass "flag-off: sentinel count unchanged"
else
  _fail "flag-off: sentinel count changed ($sentinel_count -> $sentinel_count_after)"
fi

# ── Test (b): flag-on = event written with required fields, sentinel preserved ─

echo ""
echo "=== (b) flag-on: event written, required fields, sentinel preserved ==="

REPO_B=$(_make_fixture "flag_on" "true")
SESSION_B="test-session-b"
FAKE_HOME_B="$TMPDIR_BASE/home_b"

# Place a stub JSONL transcript
ENCODED_CWD=$(echo "$REPO_B" | sed 's|^/||' | sed 's|/|-|g')
JSONL_PATH_B="$FAKE_HOME_B/.claude/projects/$ENCODED_CWD/$SESSION_B.jsonl"
_make_jsonl "$JSONL_PATH_B"

# Write sentinel first
_run_sentinel_command "$REPO_B"
sentinel_count_b=$(ls "$REPO_B/.pHive/interrupts/" | wc -l | tr -d ' ')

# Run dispatcher with transcript path passed directly
_run_dispatcher_with_transcript "$REPO_B" "$SESSION_B" "$JSONL_PATH_B" 2>/dev/null

# Check event file was created
EVENTS_DIR_B="$REPO_B/.pHive/metrics/events"
if [ -d "$EVENTS_DIR_B" ] && [ "$(ls "$EVENTS_DIR_B" | wc -l | tr -d ' ')" -gt "0" ]; then
  _pass "flag-on: events directory and files created"
else
  _fail "flag-on: no event files found in $EVENTS_DIR_B"
fi

# Validate event fields
EVENT_FILE_B=$(ls "$EVENTS_DIR_B"/*.jsonl 2>/dev/null | head -1)
if [ -n "$EVENT_FILE_B" ]; then
  FIRST_ROW=$(head -1 "$EVENT_FILE_B")

  # Required schema fields
  for field in event_id timestamp run_id metric_type value unit dimensions source; do
    if echo "$FIRST_ROW" | jq -e "has(\"$field\")" > /dev/null 2>&1; then
      _pass "flag-on: required field present: $field"
    else
      _fail "flag-on: missing required field: $field"
    fi
  done

  # story_id present (required by schema: one-of story_id/proposal_id)
  if echo "$FIRST_ROW" | jq -e 'has("story_id")' > /dev/null 2>&1; then
    _pass "flag-on: story_id present"
  else
    _fail "flag-on: story_id missing"
  fi

  # Token metric type present somewhere in file
  if grep -q '"metric_type":"tokens"' "$EVENT_FILE_B"; then
    _pass "flag-on: tokens metric_type row present"
  else
    _fail "flag-on: no tokens metric_type row found"
  fi

  # wall_clock_ms metric type present
  if grep -q '"metric_type":"wall_clock_ms"' "$EVENT_FILE_B"; then
    _pass "flag-on: wall_clock_ms metric_type row present"
  else
    _fail "flag-on: no wall_clock_ms row found"
  fi

  # Token value > 0 (from stub JSONL: 100+200+80+150 = 530 total)
  TOKEN_ROW=$(grep '"metric_type":"tokens"' "$EVENT_FILE_B" | head -1)
  TOKEN_VALUE=$(echo "$TOKEN_ROW" | jq -r '.value // 0')
  if [ "$TOKEN_VALUE" -gt "0" ]; then
    _pass "flag-on: token value is non-zero ($TOKEN_VALUE)"
  else
    _fail "flag-on: token value is zero"
  fi

  # Check dimensions has input_tokens and output_tokens
  if echo "$TOKEN_ROW" | jq -e '.dimensions.input_tokens != null and .dimensions.output_tokens != null' > /dev/null 2>&1; then
    _pass "flag-on: dimensions carry input/output token breakdown"
  else
    _fail "flag-on: dimensions missing token breakdown"
  fi
else
  _fail "flag-on: could not find event file"
fi

# Sentinel still present
sentinel_count_b_after=$(ls "$REPO_B/.pHive/interrupts/" | wc -l | tr -d ' ')
if [ "$sentinel_count_b_after" -eq "$sentinel_count_b" ]; then
  _pass "flag-on: sentinel count unchanged"
else
  _fail "flag-on: sentinel count changed ($sentinel_count_b -> $sentinel_count_b_after)"
fi

# ── Test (c): metrics script failure = sentinel still writes ──────────────────

echo ""
echo "=== (c) dispatcher failure: sentinel writes proceed ==="

REPO_C=$(_make_fixture "failure_test" "true")

# Write a broken dispatcher that always fails non-zero
cat > "$REPO_C/hooks/metrics-stop-dispatch.sh" <<'SH'
#!/bin/bash
exit 99
SH
chmod +x "$REPO_C/hooks/metrics-stop-dispatch.sh"

# Simulate the combined hook behavior from plugin.json:
# sentinel runs first, then metrics dispatcher with "|| true"
(
  cd "$REPO_C"
  ts=$(date -u +%Y-%m-%dT%H%M%SZ)
  mkdir -p .pHive/interrupts
  printf 'interrupted_at: "%s"\ninterruption_type: forced_stop\nactive_epic: null\nactive_story: null\nactive_step: null\n' "$ts" > ".pHive/interrupts/$ts.yaml"
)
(cd "$REPO_C" && bash "$REPO_C/hooks/metrics-stop-dispatch.sh" || true) 2>/dev/null

sentinel_count_c=$(ls "$REPO_C/.pHive/interrupts/" | wc -l | tr -d ' ')
if [ "$sentinel_count_c" -ge "1" ]; then
  _pass "failure: sentinel written despite dispatcher failure"
else
  _fail "failure: sentinel not written when dispatcher fails"
fi

# No events dir either (broken dispatcher wrote nothing)
if [ ! -d "$REPO_C/.pHive/metrics/events" ] || [ "$(ls "$REPO_C/.pHive/metrics/events/" 2>/dev/null | wc -l | tr -d ' ')" -eq "0" ]; then
  _pass "failure: no stale events from broken dispatcher"
else
  _fail "failure: unexpected events from broken dispatcher"
fi

# ── Test (d): idempotency — second run appends, does not overwrite ─────────────

echo ""
echo "=== (d) idempotency: second invocation appends new row ==="

REPO_D=$(_make_fixture "idempotency" "true")
SESSION_D="test-session-d"
FAKE_HOME_D="$TMPDIR_BASE/home_d"

ENCODED_CWD_D=$(echo "$REPO_D" | sed 's|^/||' | sed 's|/|-|g')
JSONL_PATH_D="$FAKE_HOME_D/.claude/projects/$ENCODED_CWD_D/$SESSION_D.jsonl"
_make_jsonl "$JSONL_PATH_D"

# Run twice
_run_dispatcher_with_transcript "$REPO_D" "$SESSION_D" "$JSONL_PATH_D" 2>/dev/null
# Small sleep to get distinct timestamps/event_ids
sleep 1
_run_dispatcher_with_transcript "$REPO_D" "$SESSION_D" "$JSONL_PATH_D" 2>/dev/null

EVENTS_DIR_D="$REPO_D/.pHive/metrics/events"
EVENT_FILE_D=$(ls "$EVENTS_DIR_D"/*.jsonl 2>/dev/null | head -1)

if [ -n "$EVENT_FILE_D" ]; then
  ROW_COUNT=$(wc -l < "$EVENT_FILE_D" | tr -d ' ')
  # Two runs × 2 rows each = 4 rows
  if [ "$ROW_COUNT" -ge "4" ]; then
    _pass "idempotency: second run appended rows (total: $ROW_COUNT)"
  else
    _fail "idempotency: expected >=4 rows after 2 runs, got $ROW_COUNT"
  fi

  # All event_ids must be unique
  UNIQUE_IDS=$(jq -r '.event_id' "$EVENT_FILE_D" | sort -u | wc -l | tr -d ' ')
  if [ "$UNIQUE_IDS" -eq "$ROW_COUNT" ]; then
    _pass "idempotency: all event_ids are unique"
  else
    _fail "idempotency: duplicate event_ids found ($UNIQUE_IDS unique vs $ROW_COUNT rows)"
  fi
else
  _fail "idempotency: no event file found"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════"
echo "Results: $PASS passed, $FAIL failed"
if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo "Failures:"
  for err in "${ERRORS[@]}"; do
    echo "  - $err"
  done
  echo "══════════════════════════════════════════"
  exit 1
else
  echo "All tests passed."
  echo "══════════════════════════════════════════"
  exit 0
fi
