#!/usr/bin/env bash
# Closure validator tests (A2.5)
# Exercises the non-bypassable closure invariant from B0 §1.11 + user-decisions Q3.
# Each test constructs a candidate close record and asserts the validator rejects
# invalid cases while accepting the all-fields-present case.

set -euo pipefail
FAILED=0
PASSED=0

pass() { PASSED=$((PASSED+1)); echo "[PASS] $1"; return 0; }
fail() { FAILED=$((FAILED+1)); echo "[FAIL] $1"; return 0; }

# Helper: validates a candidate close record. Returns 0 on valid, 1 on invalid.
# Reads commit_ref, metrics_snapshot, rollback_ref from env vars.
validate_closure() {
  local commit_ref="${CLOSE_COMMIT_REF:-}"
  local metrics_snapshot="${CLOSE_METRICS_SNAPSHOT:-}"
  local rollback_ref="${CLOSE_ROLLBACK_REF:-}"

  # Rule 1: commit_ref must be a real git ref
  if [[ -z "$commit_ref" || "$commit_ref" == "TBD" || "$commit_ref" == "pending" ]]; then
    echo "REJECT: commit_ref is placeholder or empty ($commit_ref)" >&2
    return 1
  fi
  if ! git rev-parse --verify "${commit_ref}^{commit}" >/dev/null 2>&1; then
    echo "REJECT: commit_ref does not resolve ($commit_ref)" >&2
    return 1
  fi

  # Rule 2: metrics_snapshot must be non-empty
  if [[ -z "$metrics_snapshot" ]]; then
    echo "REJECT: metrics_snapshot missing" >&2
    return 1
  fi

  # Rule 3: rollback_ref must be a real git ref
  if [[ -z "$rollback_ref" ]]; then
    echo "REJECT: rollback_ref missing" >&2
    return 1
  fi
  if ! git rev-parse --verify "${rollback_ref}^{commit}" >/dev/null 2>&1; then
    echo "REJECT: rollback_ref does not resolve ($rollback_ref)" >&2
    return 1
  fi

  return 0
}

# A known-good commit ref to use in tests: HEAD (always resolves)
GOOD_REF="$(git rev-parse HEAD)"

# Test cases
echo "=== closure-validator tests ==="

# case 1: all fields valid → accept
CLOSE_COMMIT_REF="$GOOD_REF" CLOSE_METRICS_SNAPSHOT=".pHive/metrics/experiments/test.yaml" CLOSE_ROLLBACK_REF="$GOOD_REF" \
  validate_closure >/dev/null 2>&1 && pass "all fields valid → accept" || fail "all fields valid → accept"

# case 2: commit_ref = TBD → reject
CLOSE_COMMIT_REF="TBD" CLOSE_METRICS_SNAPSHOT=".pHive/metrics/experiments/test.yaml" CLOSE_ROLLBACK_REF="$GOOD_REF" \
  validate_closure >/dev/null 2>&1 && fail "commit_ref=TBD should reject" || pass "commit_ref=TBD → reject"

# case 3: commit_ref empty → reject
CLOSE_COMMIT_REF="" CLOSE_METRICS_SNAPSHOT=".pHive/metrics/experiments/test.yaml" CLOSE_ROLLBACK_REF="$GOOD_REF" \
  validate_closure >/dev/null 2>&1 && fail "commit_ref empty should reject" || pass "commit_ref empty → reject"

# case 4: commit_ref doesn't resolve (bogus hash) → reject
CLOSE_COMMIT_REF="deadbeef00000000000000000000000000000000" CLOSE_METRICS_SNAPSHOT=".pHive/metrics/experiments/test.yaml" CLOSE_ROLLBACK_REF="$GOOD_REF" \
  validate_closure >/dev/null 2>&1 && fail "bogus commit_ref should reject" || pass "bogus commit_ref → reject"

# case 5: metrics_snapshot missing → reject
CLOSE_COMMIT_REF="$GOOD_REF" CLOSE_METRICS_SNAPSHOT="" CLOSE_ROLLBACK_REF="$GOOD_REF" \
  validate_closure >/dev/null 2>&1 && fail "metrics_snapshot empty should reject" || pass "metrics_snapshot empty → reject"

# case 6: rollback_ref missing → reject
CLOSE_COMMIT_REF="$GOOD_REF" CLOSE_METRICS_SNAPSHOT=".pHive/metrics/experiments/test.yaml" CLOSE_ROLLBACK_REF="" \
  validate_closure >/dev/null 2>&1 && fail "rollback_ref empty should reject" || pass "rollback_ref empty → reject"

# case 7: rollback_ref doesn't resolve → reject
CLOSE_COMMIT_REF="$GOOD_REF" CLOSE_METRICS_SNAPSHOT=".pHive/metrics/experiments/test.yaml" CLOSE_ROLLBACK_REF="zzzzzzz" \
  validate_closure >/dev/null 2>&1 && fail "bogus rollback_ref should reject" || pass "bogus rollback_ref → reject"

echo ""
echo "=== Result: $PASSED passed, $FAILED failed ==="
[[ $FAILED -eq 0 ]] || exit 1
