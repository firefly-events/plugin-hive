#!/usr/bin/env bash
# metrics-stop-dispatch.sh tests (story hqp-6-stop-hook-bound).
#
# Covers: byte-for-byte parity of the streaming _extract_tokens rewrite
# against a normal-size fixture, and the in-script size guard skipping the
# parse (with a logged skip row) above metrics.stop_dispatch_max_transcript_bytes.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$REPO_ROOT/hooks/metrics-stop-dispatch.sh"

PASS=0
FAIL=0
TMPDIR_BASE=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BASE"' EXIT

pass() { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }

assert_eq() {
  local expected="$1" actual="$2" label="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

# --- fixture: normal-size transcript with mixed row types ------------------
FIXTURE="$TMPDIR_BASE/fixture.jsonl"
cat >"$FIXTURE" <<'EOF'
{"type":"user","message":{"content":[{"type":"text","text":"hi"}]}}
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":100,"output_tokens":20,"cache_creation_input_tokens":5,"cache_read_input_tokens":10}}}
{"type":"tool_result","message":{"content":[{"type":"text","text":"ok"}]}}
{"type":"assistant","message":{"model":"claude-opus-5","usage":{"input_tokens":300,"output_tokens":40,"cache_creation_input_tokens":0,"cache_read_input_tokens":50}}}
{"type":"assistant","message":{"model":"claude-sonnet-5","usage":{"input_tokens":50,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
EOF

# --- old-implementation reference output (byte-for-byte target) ------------
OLD_OUTPUT=$(jq -c -s '
  [.[] | select(.type == "assistant" and .message.usage != null)]
  | {
      input_tokens: (map(.message.usage.input_tokens // 0) | add // 0),
      output_tokens: (map(.message.usage.output_tokens // 0) | add // 0),
      cache_creation_input_tokens: (map(.message.usage.cache_creation_input_tokens // 0) | add // 0),
      cache_read_input_tokens: (map(.message.usage.cache_read_input_tokens // 0) | add // 0),
      model: ([ .[] | .message.model ] | unique | join(",")),
      codex_gap: false
    }
' "$FIXTURE")

_run_hook() {
  local session_id="$1"
  local config_dir="$2"
  local transcript="${3:-$FIXTURE}"
  local payload
  payload=$(jq -nc --arg sid "$session_id" --arg tp "$transcript" \
    '{session_id: $sid, transcript_path: $tp, cwd: "'"$REPO_ROOT"'"}')
  printf '%s' "$payload" | HIVE_ROOT="$config_dir" HIVE_STATE_DIR="$config_dir/.pHive" bash "$HOOK"
}

# --- test 1: byte-for-byte token parity on a normal-size fixture -----------
CONFIG_DIR_1="$TMPDIR_BASE/proj1"
mkdir -p "$CONFIG_DIR_1"
cat >"$CONFIG_DIR_1/hive.config.yaml" <<EOF
metrics:
  enabled: true
  stop_dispatch_max_transcript_bytes: 314572800
EOF

SESSION_1="test-session-normal"
_run_hook "$SESSION_1" "$CONFIG_DIR_1"
EVENTS_FILE_1="$CONFIG_DIR_1/.pHive/metrics/events/stop-${SESSION_1}.jsonl"

if [[ -f "$EVENTS_FILE_1" ]]; then
  TOKEN_ROW=$(grep '"metric_type":"tokens"' "$EVENTS_FILE_1" | head -1)
  ACTUAL_INPUT=$(echo "$TOKEN_ROW" | jq -r '.dimensions.input_tokens')
  ACTUAL_OUTPUT=$(echo "$TOKEN_ROW" | jq -r '.dimensions.output_tokens')
  ACTUAL_CACHE_C=$(echo "$TOKEN_ROW" | jq -r '.dimensions.cache_creation_input_tokens')
  ACTUAL_CACHE_R=$(echo "$TOKEN_ROW" | jq -r '.dimensions.cache_read_input_tokens')
  ACTUAL_MODEL=$(echo "$TOKEN_ROW" | jq -r '.dimensions.model')

  EXPECTED_INPUT=$(echo "$OLD_OUTPUT" | jq -r '.input_tokens')
  EXPECTED_OUTPUT=$(echo "$OLD_OUTPUT" | jq -r '.output_tokens')
  EXPECTED_CACHE_C=$(echo "$OLD_OUTPUT" | jq -r '.cache_creation_input_tokens')
  EXPECTED_CACHE_R=$(echo "$OLD_OUTPUT" | jq -r '.cache_read_input_tokens')
  EXPECTED_MODEL=$(echo "$OLD_OUTPUT" | jq -r '.model')

  assert_eq "$EXPECTED_INPUT" "$ACTUAL_INPUT" "input_tokens matches old slurp implementation"
  assert_eq "$EXPECTED_OUTPUT" "$ACTUAL_OUTPUT" "output_tokens matches old slurp implementation"
  assert_eq "$EXPECTED_CACHE_C" "$ACTUAL_CACHE_C" "cache_creation_input_tokens matches old slurp implementation"
  assert_eq "$EXPECTED_CACHE_R" "$ACTUAL_CACHE_R" "cache_read_input_tokens matches old slurp implementation"
  assert_eq "$EXPECTED_MODEL" "$ACTUAL_MODEL" "model list (sorted, joined) matches old slurp implementation"
else
  fail "events file was not written for normal-size fixture ($EVENTS_FILE_1)"
fi

# --- test 2: metrics.enabled: false short-circuit is unchanged -------------
CONFIG_DIR_2="$TMPDIR_BASE/proj2"
mkdir -p "$CONFIG_DIR_2"
cat >"$CONFIG_DIR_2/hive.config.yaml" <<EOF
metrics:
  enabled: false
EOF
SESSION_2="test-session-disabled"
_run_hook "$SESSION_2" "$CONFIG_DIR_2"
EVENTS_FILE_2="$CONFIG_DIR_2/.pHive/metrics/events/stop-${SESSION_2}.jsonl"
if [[ ! -f "$EVENTS_FILE_2" ]]; then
  pass "metrics.enabled:false still exits before writing any events file"
else
  fail "metrics.enabled:false unexpectedly wrote an events file"
fi

# --- test 3: size guard skips the parse above the configured threshold -----
BIG_FIXTURE="$TMPDIR_BASE/big.jsonl"
cp "$FIXTURE" "$BIG_FIXTURE"
# Pad past a tiny threshold so the guard fires deterministically without
# generating a real multi-hundred-MB file in the test suite.
python3 -c "
with open('$BIG_FIXTURE', 'a') as f:
    f.write('{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"' + ('x' * 2000) + '\"}]}}\n' * 50)
"

CONFIG_DIR_3="$TMPDIR_BASE/proj3"
mkdir -p "$CONFIG_DIR_3"
cat >"$CONFIG_DIR_3/hive.config.yaml" <<EOF
metrics:
  enabled: true
  stop_dispatch_max_transcript_bytes: 1000
EOF

SESSION_3="test-session-oversized"
_run_hook "$SESSION_3" "$CONFIG_DIR_3" "$BIG_FIXTURE"

EVENTS_FILE_3="$CONFIG_DIR_3/.pHive/metrics/events/stop-${SESSION_3}.jsonl"
if [[ -f "$EVENTS_FILE_3" ]]; then
  SKIP_ROW=$(grep '"metric_type":"transcript_skipped"' "$EVENTS_FILE_3" | head -1)
  TOKEN_ROW_3=$(grep '"metric_type":"tokens"' "$EVENTS_FILE_3" | head -1)
  if [[ -n "$SKIP_ROW" ]]; then
    pass "size guard logs a transcript_skipped row for an oversized transcript"
    SKIP_RUN_ID=$(echo "$SKIP_ROW" | jq -r '.run_id // empty')
    if [[ -n "$SKIP_RUN_ID" ]]; then
      pass "transcript_skipped row includes run_id (REQUIRED_EVENT_FIELDS)"
    else
      fail "transcript_skipped row is missing run_id, a required metrics-event field"
    fi
  else
    fail "size guard did not log a transcript_skipped row"
  fi
  if [[ -z "$TOKEN_ROW_3" ]]; then
    pass "size guard skips the token-extraction parse entirely for an oversized transcript"
  else
    fail "size guard did not skip the token parse — a tokens row was written anyway"
  fi
else
  fail "events file was not written for the size-guard skip case ($EVENTS_FILE_3)"
fi

# --- test 4: non-numeric config value falls back to the default, not a ------
# --- silently-disabled guard (CodeRabbit review, PR #341) -------------------
CONFIG_DIR_4="$TMPDIR_BASE/proj4"
mkdir -p "$CONFIG_DIR_4"
cat >"$CONFIG_DIR_4/hive.config.yaml" <<EOF
metrics:
  enabled: true
  stop_dispatch_max_transcript_bytes: "not-a-number"
EOF

SESSION_4="test-session-bad-config"
_run_hook "$SESSION_4" "$CONFIG_DIR_4"
EVENTS_FILE_4="$CONFIG_DIR_4/.pHive/metrics/events/stop-${SESSION_4}.jsonl"
if [[ -f "$EVENTS_FILE_4" ]]; then
  TOKEN_ROW_4=$(grep '"metric_type":"tokens"' "$EVENTS_FILE_4" | head -1)
  if [[ -n "$TOKEN_ROW_4" ]]; then
    pass "non-numeric stop_dispatch_max_transcript_bytes falls back to the 300MB default (normal-size fixture still parses)"
  else
    fail "non-numeric config value broke the token parse instead of falling back to the default"
  fi
else
  fail "events file was not written when stop_dispatch_max_transcript_bytes was non-numeric ($EVENTS_FILE_4)"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
