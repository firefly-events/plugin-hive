#!/usr/bin/env bash
# act-i-exit-gate-check.sh
#
# Closes the S7-kg-signal-production-emission outcome metric loop from the
# prior epic (kg-augmented-meta-signal). Run as a post-/meta-optimize-cycle
# verification hook out of step-08-close.md.
#
# Emits:
#   [kg-signal-revival] act-i-exit-gate: count=N
# And on the FIRST transition from zero → non-zero:
#   [kg-signal-revival] act-i-exit-gate: PASSED (closes S7 outcome metric)
#
# Idempotent — safe to re-run. A stamp file at $STAMP_PATH prevents the
# PASSED marker from firing more than once per install.
#
# Silent-no-op when kg.sqlite is missing (consistent with kg_emit fire-and-
# forget semantics).

set -u

KG_DB="${HIVE_KG_SQLITE_PATH:-$HOME/.claude/hive/kg.sqlite}"
STAMP_PATH="${ACT_I_GATE_STAMP_PATH:-$HOME/.claude/hive/act-i-exit-gate-passed}"

if [ ! -f "$KG_DB" ]; then
  echo "[kg-signal-revival] act-i-exit-gate: count=0 (kg.sqlite absent at $KG_DB)"
  exit 0
fi

count=$(sqlite3 "$KG_DB" \
  "SELECT COUNT(*) FROM triples WHERE predicate IN ('phase_failed','phase_blocked','superseded');" \
  2>/dev/null || echo 0)

# Normalize to an integer; sqlite errors fall through as 0.
case "$count" in
  ''|*[!0-9]*) count=0 ;;
esac

echo "[kg-signal-revival] act-i-exit-gate: count=$count"

if [ "$count" -gt 0 ] && [ ! -f "$STAMP_PATH" ]; then
  echo "[kg-signal-revival] act-i-exit-gate: PASSED (closes S7 outcome metric)"
  mkdir -p "$(dirname "$STAMP_PATH")"
  date -u +"%Y-%m-%dT%H:%M:%SZ" > "$STAMP_PATH" || true
fi

exit 0
