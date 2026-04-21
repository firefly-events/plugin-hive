#!/usr/bin/env bash
# human-escalation.test.sh — tests for metrics-human-escalation.sh
# Covers: (a) flag-off silence, (b) flag-on schema-valid emission,
#         (c) correlation fields present.

set -euo pipefail

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED+1)); echo "[PASS] $1"; }
fail() { FAILED=$((FAILED+1)); echo "[FAIL] $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
HOOK="$HIVE_ROOT/hooks/metrics-human-escalation.sh"

# Setup: isolated temp dir so tests never write to the real metrics dir
TMPDIR_BASE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BASE"' EXIT

make_config() {
  local enabled="$1"
  local dir="$TMPDIR_BASE/fake-pHive/metrics"
  cat <<EOF
metrics:
  enabled: $enabled
  dir: $TMPDIR_BASE/fake-pHive/metrics
EOF
}

# ─── (a) Flag-off silence ────────────────────────────────────────────────────

echo "=== (a) flag-off silence ==="

CONFIG_OFF="$TMPDIR_BASE/config-off.yaml"
make_config false > "$CONFIG_OFF"

EVENTS_DIR="$TMPDIR_BASE/fake-pHive/metrics/events"

# Run hook with disabled config; should produce no file
HIVE_ROOT="$TMPDIR_BASE" bash "$HOOK" \
  --run-id run_test_001 \
  --story-id C2.6 \
  --reason scope-ambiguity 2>/dev/null || true

if [[ ! -f "$EVENTS_DIR/human-escalation.jsonl" ]]; then
  pass "flag-off: no event file created"
else
  fail "flag-off: event file was created when metrics disabled"
fi

# ─── Setup for flag-on tests ─────────────────────────────────────────────────

# Create a fake hive directory with enabled config
FAKE_HIVE="$TMPDIR_BASE/fake-hive-on"
mkdir -p "$FAKE_HIVE/hive"
cat > "$FAKE_HIVE/hive/hive.config.yaml" <<EOF
metrics:
  enabled: true
  dir: .pHive/metrics
EOF
mkdir -p "$FAKE_HIVE/hooks"
cp "$HOOK" "$FAKE_HIVE/hooks/metrics-human-escalation.sh"

ON_EVENTS="$FAKE_HIVE/.pHive/metrics/events"

echo ""
echo "=== (b) flag-on schema-valid emission ==="

HIVE_ROOT="$FAKE_HIVE" bash "$FAKE_HIVE/hooks/metrics-human-escalation.sh" \
  --run-id "run_test_on_001" \
  --story-id "C2.6" \
  --swarm-id "meta-improvement-system" \
  --phase "orchestration" \
  --agent "orchestrator" \
  --reason "scope-ambiguity"

if [[ -f "$ON_EVENTS/human-escalation.jsonl" ]]; then
  pass "flag-on: event file created"
else
  fail "flag-on: event file not created"
fi

LINE="$(tail -1 "$ON_EVENTS/human-escalation.jsonl" 2>/dev/null || true)"

# Check valid JSON
if echo "$LINE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  pass "event is valid JSON"
else
  fail "event is not valid JSON"
fi

# Required schema fields
for field in event_id timestamp run_id metric_type value unit dimensions source; do
  if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$field' in d" 2>/dev/null; then
    pass "required field present: $field"
  else
    fail "required field missing: $field"
  fi
done

# metric_type must be human_escalation
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['metric_type']=='human_escalation'" 2>/dev/null; then
  pass "metric_type=human_escalation"
else
  fail "metric_type wrong"
fi

# value must be boolean true
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['value'] is True" 2>/dev/null; then
  pass "value=true (bool)"
else
  fail "value is not boolean true"
fi

# unit must be bool
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['unit']=='bool'" 2>/dev/null; then
  pass "unit=bool"
else
  fail "unit wrong"
fi

# source must be orchestrator-escalation-path
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['source']=='orchestrator-escalation-path'" 2>/dev/null; then
  pass "source=orchestrator-escalation-path"
else
  fail "source wrong"
fi

# dimensions is an object
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert isinstance(d['dimensions'], dict)" 2>/dev/null; then
  pass "dimensions is object"
else
  fail "dimensions is not object"
fi

echo ""
echo "=== (c) correlation fields present ==="

# story_id XOR proposal_id must be present
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert ('story_id' in d) ^ ('proposal_id' in d)" 2>/dev/null; then
  pass "exactly one of story_id/proposal_id present"
else
  fail "story_id/proposal_id cardinality wrong"
fi

# story_id value correct
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('story_id')=='C2.6'" 2>/dev/null; then
  pass "story_id=C2.6"
else
  fail "story_id value wrong"
fi

# run_id value correct
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['run_id']=='run_test_on_001'" 2>/dev/null; then
  pass "run_id present and correct"
else
  fail "run_id wrong"
fi

# swarm_id present
if echo "$LINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('swarm_id')=='meta-improvement-system'" 2>/dev/null; then
  pass "swarm_id present and correct"
else
  fail "swarm_id wrong"
fi

# --- proposal_id path --------------------------------------------------------
echo ""
echo "=== (b2) proposal_id correlation path ==="

HIVE_ROOT="$FAKE_HIVE" bash "$FAKE_HIVE/hooks/metrics-human-escalation.sh" \
  --run-id "run_test_proposal_001" \
  --proposal-id "backlog-017" \
  --reason "ambiguous-scope"

PLINE="$(tail -1 "$ON_EVENTS/human-escalation.jsonl")"

if echo "$PLINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('proposal_id')=='backlog-017' and 'story_id' not in d" 2>/dev/null; then
  pass "proposal_id path: proposal_id set, story_id absent"
else
  fail "proposal_id path: correlation fields wrong"
fi

# ─── (d) event_id uniqueness on same-second emissions ────────────────────────
echo ""
echo "=== (d) event_id uniqueness ==="

# Emit twice without sleeping — both calls use the same second timestamp.
HIVE_ROOT="$FAKE_HIVE" bash "$FAKE_HIVE/hooks/metrics-human-escalation.sh" \
  --run-id "run_uniq_001" \
  --story-id "C2.6" \
  --reason "first"

HIVE_ROOT="$FAKE_HIVE" bash "$FAKE_HIVE/hooks/metrics-human-escalation.sh" \
  --run-id "run_uniq_001" \
  --story-id "C2.6" \
  --reason "second"

ID1=$(tail -2 "$ON_EVENTS/human-escalation.jsonl" | head -1 | python3 -c "import sys,json; print(json.load(sys.stdin)['event_id'])")
ID2=$(tail -1 "$ON_EVENTS/human-escalation.jsonl" | python3 -c "import sys,json; print(json.load(sys.stdin)['event_id'])")

if [[ "$ID1" != "$ID2" ]]; then
  pass "same-second emissions produce distinct event_id values"
else
  fail "same-second emissions produced identical event_id: $ID1"
fi

# ─── (e) embedded-quote reason roundtrip ─────────────────────────────────────
echo ""
echo "=== (e) embedded-quote reason roundtrip ==="

HIVE_ROOT="$FAKE_HIVE" bash "$FAKE_HIVE/hooks/metrics-human-escalation.sh" \
  --run-id "run_quote_001" \
  --story-id "C2.6" \
  --reason 'a"b\c'

QLINE=$(tail -1 "$ON_EVENTS/human-escalation.jsonl")

if echo "$QLINE" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  pass "embedded-quote reason: JSON parses cleanly"
else
  fail "embedded-quote reason: JSON parse failed"
fi

if echo "$QLINE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['dimensions']['reason'] == 'a\"b\\\\c', repr(d['dimensions']['reason'])" 2>/dev/null; then
  pass "embedded-quote reason: exact roundtrip a\"b\\c"
else
  fail "embedded-quote reason: roundtrip value wrong"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "=== Result: $PASSED passed, $FAILED failed ==="
[[ $FAILED -eq 0 ]] || exit 1
