#!/usr/bin/env bash
# token-capture.test.sh — C2.3 per-agent token capture tests
#
# Covers:
#  (a) flag-off silence: no event written when metrics.enabled: false
#  (b) flag-on emission: real token counts from JSONL fixtures
#  (c) graceful degradation: assistant row with null usage → codex_gap row
#  (d) schema validity: every emitted row satisfies §7 invariants
#  (e) per-agent scoping: multiple subagent JSONLs → distinct per-agent rows
#  (f) codex gap path: agent JSONL absent → row emitted with codex_gap: true

set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "$0")/../../.." rev-parse --show-toplevel)"
CAPTURE="$REPO_ROOT/hooks/metrics-token-capture.sh"

PASS=0
FAIL=0
ERRORS=()

_pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
_fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); ERRORS+=("$1"); }

TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

# ── Fixture helpers ──────────────────────────────────────────────────────────

_make_repo() {
  local name="$1" enabled="$2"
  local dir="$TMPDIR_BASE/$name"
  mkdir -p "$dir/hive" "$dir/.pHive/metrics"
  cat > "$dir/hive/hive.config.yaml" <<YAML
metrics:
  enabled: $enabled
  dir: .pHive/metrics
YAML
  echo "$dir"
}

# Realistic main JSONL with two assistant turns (main thread)
_make_main_jsonl() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'JSONL'
{"type":"assistant","sessionId":"test-sess-001","isSidechain":false,"timestamp":"2026-04-21T10:00:00Z","message":{"model":"claude-opus-4-7","usage":{"input_tokens":100,"output_tokens":200,"cache_creation_input_tokens":50,"cache_read_input_tokens":300}}}
{"type":"assistant","sessionId":"test-sess-001","isSidechain":false,"timestamp":"2026-04-21T10:01:00Z","message":{"model":"claude-opus-4-7","usage":{"input_tokens":80,"output_tokens":150,"cache_creation_input_tokens":0,"cache_read_input_tokens":120}}}
{"type":"user","sessionId":"test-sess-001","message":{"role":"user","content":"task"}}
JSONL
}

# Subagent JSONL (isSidechain rows, typical subagent file — no isSidechain filter needed here
# since the file is agent-scoped; only assistant rows matter)
_make_subagent_jsonl() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'JSONL'
{"type":"assistant","sessionId":"test-sess-001","isSidechain":true,"timestamp":"2026-04-21T10:02:00Z","message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":40,"output_tokens":60,"cache_creation_input_tokens":10,"cache_read_input_tokens":80}}}
{"type":"assistant","sessionId":"test-sess-001","isSidechain":true,"timestamp":"2026-04-21T10:03:00Z","message":{"model":"claude-haiku-4-5-20251001","usage":{"input_tokens":30,"output_tokens":45,"cache_creation_input_tokens":0,"cache_read_input_tokens":50}}}
JSONL
}

# Subagent JSONL with null usage rows (graceful degradation fixture, AC-3)
_make_null_usage_jsonl() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<'JSONL'
{"type":"assistant","sessionId":"test-sess-002","isSidechain":true,"timestamp":"2026-04-21T10:04:00Z","message":{"model":"claude-haiku-4-5-20251001","usage":null}}
{"type":"user","sessionId":"test-sess-002","message":{"role":"user","content":"hello"}}
JSONL
}

# Write a meta.json for a subagent
_make_meta_json() {
  local path="$1" agent_type="$2" desc="$3"
  mkdir -p "$(dirname "$path")"
  printf '{"agentType":"%s","description":"%s"}\n' "$agent_type" "$desc" > "$path"
}

# Run the capture script (no stdin required — it takes CLI args)
_run_capture() {
  local repo="$1"; shift
  (
    cd "$repo"
    export HIVE_ROOT="$repo"
    bash "$CAPTURE" "$@"
  )
}

# Validate a single JSON row against schema §7 invariants
# Returns 0 if valid, 1 if not; prints reason on failure
_validate_row() {
  local row="$1"
  local ok=0

  for field in event_id timestamp run_id metric_type value unit dimensions source; do
    if ! echo "$row" | jq -e "has(\"$field\")" > /dev/null 2>&1; then
      echo "    schema: missing field: $field" >&2
      ok=1
    fi
  done

  # exactly one of story_id / proposal_id
  has_story=$(echo "$row" | jq 'has("story_id")' 2>/dev/null)
  has_proposal=$(echo "$row" | jq 'has("proposal_id")' 2>/dev/null)
  if [ "$has_story" = "false" ] && [ "$has_proposal" = "false" ]; then
    echo "    schema: missing story_id and proposal_id" >&2
    ok=1
  fi
  if [ "$has_story" = "true" ] && [ "$has_proposal" = "true" ]; then
    echo "    schema: both story_id and proposal_id present" >&2
    ok=1
  fi

  # metric_type must be "tokens"
  mt=$(echo "$row" | jq -r '.metric_type // ""' 2>/dev/null)
  if [ "$mt" != "tokens" ]; then
    echo "    schema: metric_type='$mt', expected 'tokens'" >&2
    ok=1
  fi

  # unit must be "tokens"
  unit=$(echo "$row" | jq -r '.unit // ""' 2>/dev/null)
  if [ "$unit" != "tokens" ]; then
    echo "    schema: unit='$unit', expected 'tokens'" >&2
    ok=1
  fi

  return $ok
}

# ── (a) flag-off silence ─────────────────────────────────────────────────────

echo ""
echo "=== (a) flag-off: no event written ==="

REPO_A=$(_make_repo "flag_off" "false")
SESSION_A="sess-a"
TRANSCRIPT_A="$TMPDIR_BASE/transcript_a.jsonl"
_make_main_jsonl "$TRANSCRIPT_A"

_run_capture "$REPO_A" \
  --session-id "$SESSION_A" --transcript "$TRANSCRIPT_A" \
  --run-id "run-test-a" --story-id "C2.3-test" 2>/dev/null

EVENTS_A="$REPO_A/.pHive/metrics/events"
if [ -d "$EVENTS_A" ]; then
  count_a=$(ls "$EVENTS_A" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count_a" -eq "0" ]; then
    _pass "flag-off: no event files created"
  else
    _fail "flag-off: unexpected event files ($count_a)"
  fi
else
  _pass "flag-off: events dir not created"
fi

# ── (b) flag-on emission with real token counts ──────────────────────────────

echo ""
echo "=== (b) flag-on: real token counts emitted ==="

REPO_B=$(_make_repo "flag_on" "true")
SESSION_B="sess-b"

# Main thread transcript
TRANSCRIPT_B="$TMPDIR_BASE/transcript_b.jsonl"
_make_main_jsonl "$TRANSCRIPT_B"

# Subagents directory: one subagent with usage
SUBAGENTS_B="$TMPDIR_BASE/subagents_b"
_make_subagent_jsonl "$SUBAGENTS_B/agent-sub01.jsonl"
_make_meta_json "$SUBAGENTS_B/agent-sub01.meta.json" "hive:developer" "Test developer agent"

# Use HIVE_ROOT override to control subagent path resolution requires transcript path approach
# We pass --transcript for main JSONL; subagents are resolved relative to transcript dir
# per _resolve_subagents_dir logic (dirname($transcript)/subagents)
TRANSCRIPT_B_DIR="$TMPDIR_BASE/sess_b_dir"
mkdir -p "$TRANSCRIPT_B_DIR/subagents"
cp "$TRANSCRIPT_B" "$TRANSCRIPT_B_DIR/main.jsonl"
cp "$SUBAGENTS_B/agent-sub01.jsonl" "$TRANSCRIPT_B_DIR/subagents/agent-sub01.jsonl"
cp "$SUBAGENTS_B/agent-sub01.meta.json" "$TRANSCRIPT_B_DIR/subagents/agent-sub01.meta.json"

_run_capture "$REPO_B" \
  --session-id "$SESSION_B" --transcript "$TRANSCRIPT_B_DIR/main.jsonl" \
  --run-id "run-test-b" --story-id "C2.3-test" \
  --swarm-id "meta-improvement-system" --phase "test" 2>/dev/null

EVENTS_B="$REPO_B/.pHive/metrics/events"
if [ -d "$EVENTS_B" ] && [ "$(ls "$EVENTS_B" | wc -l | tr -d ' ')" -gt "0" ]; then
  _pass "flag-on: events dir created with files"
else
  _fail "flag-on: no event files found"
fi

EVENT_FILE_B=$(ls "$EVENTS_B"/*.jsonl 2>/dev/null | head -1)
if [ -n "$EVENT_FILE_B" ]; then
  ROW_COUNT_B=$(wc -l < "$EVENT_FILE_B" | tr -d ' ')
  # Expect 2 rows: orchestrator + hive:developer
  if [ "$ROW_COUNT_B" -ge "2" ]; then
    _pass "flag-on: emitted $ROW_COUNT_B rows (>=2 expected)"
  else
    _fail "flag-on: expected >=2 rows, got $ROW_COUNT_B"
  fi

  # orchestrator row must have value > 0 (100+80+200+150 = 530)
  ORC_ROW=$(jq -c 'select(.agent == "orchestrator")' "$EVENT_FILE_B" 2>/dev/null | head -1)
  if [ -n "$ORC_ROW" ]; then
    ORC_VAL=$(echo "$ORC_ROW" | jq -r '.value // 0')
    if [ "$ORC_VAL" -gt "0" ]; then
      _pass "flag-on: orchestrator value=$ORC_VAL (non-zero)"
    else
      _fail "flag-on: orchestrator value is 0"
    fi
    [ "$ORC_VAL" = "530" ] || _fail "flag-on: orchestrator value: expected 530, got $ORC_VAL"
    if echo "$ORC_ROW" | jq -e '.dimensions.input_tokens != null and .dimensions.output_tokens != null' > /dev/null 2>&1; then
      _pass "flag-on: orchestrator dimensions carry token breakdown"
    else
      _fail "flag-on: orchestrator dimensions missing token breakdown"
    fi
    [ "$(echo "$ORC_ROW" | jq -r .dimensions.codex_gap)" = "false" ] || _fail "codex_gap should be false on populated row"
  else
    _fail "flag-on: orchestrator row not found"
  fi

  # developer agent row
  DEV_ROW=$(jq -c 'select(.agent == "hive:developer")' "$EVENT_FILE_B" 2>/dev/null | head -1)
  if [ -n "$DEV_ROW" ]; then
    DEV_VAL=$(echo "$DEV_ROW" | jq -r '.value // 0')
    if [ "$DEV_VAL" -gt "0" ]; then
      _pass "flag-on: hive:developer value=$DEV_VAL (non-zero)"
    else
      _fail "flag-on: hive:developer value is 0"
    fi
    [ "$DEV_VAL" = "175" ] || _fail "flag-on: hive:developer value: expected 175, got $DEV_VAL"
  else
    _fail "flag-on: hive:developer row not found"
  fi
else
  _fail "flag-on: could not find event file"
fi

# ── (c) graceful degradation: null usage rows ────────────────────────────────

echo ""
echo "=== (c) graceful degradation: null usage → codex_gap row ==="

REPO_C=$(_make_repo "degradation" "true")
SESSION_C="sess-c"

SESS_C_DIR="$TMPDIR_BASE/sess_c_dir"
mkdir -p "$SESS_C_DIR/subagents"

# Main JSONL: no assistant rows at all (simulates Codex-only session)
cat > "$SESS_C_DIR/main.jsonl" <<'JSONL'
{"type":"user","sessionId":"sess-c","message":{"role":"user","content":"run task"}}
JSONL

# Subagent with null usage
_make_null_usage_jsonl "$SESS_C_DIR/subagents/agent-sub02.jsonl"
_make_meta_json "$SESS_C_DIR/subagents/agent-sub02.meta.json" "hive:tester" "Test tester agent"

# Capture must not crash (AC-3)
exit_c=0
_run_capture "$REPO_C" \
  --session-id "$SESSION_C" --transcript "$SESS_C_DIR/main.jsonl" \
  --run-id "run-test-c" --story-id "C2.3-test" 2>/dev/null || exit_c=$?

if [ "$exit_c" -eq "0" ]; then
  _pass "degradation: exits 0 on null usage"
else
  _fail "degradation: non-zero exit ($exit_c)"
fi

EVENTS_C="$REPO_C/.pHive/metrics/events"
EVENT_FILE_C=$(ls "$EVENTS_C"/*.jsonl 2>/dev/null | head -1 || echo "")
if [ -n "$EVENT_FILE_C" ] && [ -s "$EVENT_FILE_C" ]; then
  # Event file exists and is non-empty: REQUIRE a codex_gap: true row
  GAP_ROW=$(jq -c 'select(.dimensions.codex_gap == true)' "$EVENT_FILE_C" 2>/dev/null | head -1)
  if [ -n "$GAP_ROW" ]; then
    GAP_VAL=$(echo "$GAP_ROW" | jq -r '.value // -1')
    if [ "$GAP_VAL" -eq "0" ]; then
      _pass "degradation: codex_gap row has value=0"
    else
      _fail "degradation: codex_gap row has value=$GAP_VAL (expected 0)"
    fi
    _pass "degradation: codex_gap: true row emitted"
  else
    _fail "degradation: event file non-empty but no codex_gap: true row found"
  fi
else
  _fail "degradation: no event file emitted; codex_gap: true row required"
fi

# ── (d) schema validity ──────────────────────────────────────────────────────

echo ""
echo "=== (d) schema validity: all emitted rows satisfy §7 invariants ==="

# Reuse event file from (b) — the richest fixture
if [ -n "${EVENT_FILE_B:-}" ] && [ -f "$EVENT_FILE_B" ]; then
  row_num=0
  all_valid=true
  while IFS= read -r row; do
    row_num=$((row_num + 1))
    if _validate_row "$row"; then
      _pass "schema: row $row_num is valid"
    else
      _fail "schema: row $row_num failed validation"
      all_valid=false
    fi
  done < "$EVENT_FILE_B"
  if [ "$row_num" -eq "0" ]; then
    _fail "schema: no rows to validate from (b) fixture"
  fi
else
  _fail "schema: event file from (b) not available"
fi

# ── (e) per-agent scoping: multiple subagents emit distinct rows ─────────────

echo ""
echo "=== (e) per-agent scoping: multiple subagents → distinct rows ==="

REPO_E=$(_make_repo "per_agent" "true")
SESSION_E="sess-e"

SESS_E_DIR="$TMPDIR_BASE/sess_e_dir"
mkdir -p "$SESS_E_DIR/subagents"

# Main JSONL
cp "$TRANSCRIPT_B_DIR/main.jsonl" "$SESS_E_DIR/main.jsonl"

# Two distinct subagents
_make_subagent_jsonl "$SESS_E_DIR/subagents/agent-subA.jsonl"
_make_meta_json "$SESS_E_DIR/subagents/agent-subA.meta.json" "hive:developer" "Developer subagent"

# Second subagent with different usage amounts (reuse _make_subagent_jsonl but different tokens)
cat > "$SESS_E_DIR/subagents/agent-subB.jsonl" <<'JSONL'
{"type":"assistant","sessionId":"sess-e","isSidechain":true,"timestamp":"2026-04-21T10:05:00Z","message":{"model":"claude-opus-4-7","usage":{"input_tokens":200,"output_tokens":350,"cache_creation_input_tokens":25,"cache_read_input_tokens":90}}}
JSONL
_make_meta_json "$SESS_E_DIR/subagents/agent-subB.meta.json" "hive:reviewer" "Reviewer subagent"

_run_capture "$REPO_E" \
  --session-id "$SESSION_E" --transcript "$SESS_E_DIR/main.jsonl" \
  --run-id "run-test-e" --story-id "C2.3-test" 2>/dev/null

EVENTS_E="$REPO_E/.pHive/metrics/events"
EVENT_FILE_E=$(ls "$EVENTS_E"/*.jsonl 2>/dev/null | head -1 || echo "")

if [ -n "$EVENT_FILE_E" ]; then
  ROW_COUNT_E=$(wc -l < "$EVENT_FILE_E" | tr -d ' ')
  # Expect 3 rows: orchestrator + hive:developer + hive:reviewer
  if [ "$ROW_COUNT_E" -ge "3" ]; then
    _pass "per-agent: emitted $ROW_COUNT_E rows (>=3 expected)"
  else
    _fail "per-agent: expected >=3 rows, got $ROW_COUNT_E"
  fi

  # Each agent must be distinct
  DISTINCT_AGENTS=$(jq -r '.agent' "$EVENT_FILE_E" | sort -u | wc -l | tr -d ' ')
  if [ "$DISTINCT_AGENTS" -ge "3" ]; then
    _pass "per-agent: $DISTINCT_AGENTS distinct agent labels"
  else
    _fail "per-agent: only $DISTINCT_AGENTS distinct agent labels"
  fi

  # developer and reviewer must both appear
  if jq -e 'select(.agent == "hive:developer")' "$EVENT_FILE_E" > /dev/null 2>&1; then
    _pass "per-agent: hive:developer row present"
  else
    _fail "per-agent: hive:developer row missing"
  fi
  if jq -e 'select(.agent == "hive:reviewer")' "$EVENT_FILE_E" > /dev/null 2>&1; then
    _pass "per-agent: hive:reviewer row present"
  else
    _fail "per-agent: hive:reviewer row missing"
  fi

  # event_ids must all be unique
  TOTAL_E=$(wc -l < "$EVENT_FILE_E" | tr -d ' ')
  UNIQUE_E=$(jq -r '.event_id' "$EVENT_FILE_E" | sort -u | wc -l | tr -d ' ')
  if [ "$UNIQUE_E" -eq "$TOTAL_E" ]; then
    _pass "per-agent: all event_ids unique"
  else
    _fail "per-agent: duplicate event_ids ($UNIQUE_E unique vs $TOTAL_E rows)"
  fi
else
  _fail "per-agent: no event file found"
fi

# ── (f) codex gap path: agent JSONL absent → codex_gap row ──────────────────

echo ""
echo "=== (f) codex gap: agent JSONL absent → codex_gap: true row ==="

REPO_F=$(_make_repo "codex_gap" "true")
SESSION_F="sess-f"

SESS_F_DIR="$TMPDIR_BASE/sess_f_dir"
mkdir -p "$SESS_F_DIR/subagents"

# Main JSONL with orchestrator tokens
cp "$TRANSCRIPT_B_DIR/main.jsonl" "$SESS_F_DIR/main.jsonl"

# Meta file present but NO corresponding .jsonl (simulates Codex-backed agent)
_make_meta_json "$SESS_F_DIR/subagents/agent-codex01.meta.json" "codex-agent" "Codex companion"
# intentionally NOT creating agent-codex01.jsonl

_run_capture "$REPO_F" \
  --session-id "$SESSION_F" --transcript "$SESS_F_DIR/main.jsonl" \
  --run-id "run-test-f" --story-id "C2.3-test" 2>/dev/null

EVENTS_F="$REPO_F/.pHive/metrics/events"
EVENT_FILE_F=$(ls "$EVENTS_F"/*.jsonl 2>/dev/null | head -1 || echo "")

if [ -n "$EVENT_FILE_F" ]; then
  CODEX_ROW=$(jq -c 'select(.agent == "codex-agent")' "$EVENT_FILE_F" 2>/dev/null | head -1)
  if [ -n "$CODEX_ROW" ]; then
    CG=$(echo "$CODEX_ROW" | jq -r '.dimensions.codex_gap // false')
    CV=$(echo "$CODEX_ROW" | jq -r '.value // -1')
    if [ "$CG" = "true" ]; then
      _pass "codex-gap: codex_gap=true on agent row"
    else
      _fail "codex-gap: codex_gap not true (got: $CG)"
    fi
    if [ "$CV" -eq "0" ]; then
      _pass "codex-gap: value=0 on codex_gap row"
    else
      _fail "codex-gap: expected value=0 on codex_gap row, got $CV"
    fi
  else
    _fail "codex-gap: no row for codex-agent found"
  fi
else
  _fail "codex-gap: no event file found"
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
