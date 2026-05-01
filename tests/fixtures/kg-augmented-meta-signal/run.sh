#!/usr/bin/env bash
# run.sh — fixture runner for kg-augmented-meta-signal S5
#
# Builds a self-contained tmp environment that the tester walks step-02c
# against (LLM-mediated). Emits fixture-state.txt with the counts and the
# SQL queries that produced them, so the AC asserts are reproducible.
#
# Strategy: no-deps. Uses /usr/bin/sqlite3 CLI; no package.json, no
# better-sqlite3. See seed.sql + README.md.
#
# Usage:
#   ./run.sh           # run, print FIXTURE-READY, then cleanup
#   ./run.sh --keep    # run, print FIXTURE-READY, leave tmp dir for inspection

set -euo pipefail

KEEP=0
if [[ "${1:-}" == "--keep" ]]; then
  KEEP=1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SEED_SQL="$SCRIPT_DIR/seed.sql"

if [[ ! -f "$SEED_SQL" ]]; then
  echo "ERROR: seed.sql not found at $SEED_SQL" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "ERROR: sqlite3 CLI is required (expected /usr/bin/sqlite3)" >&2
  exit 1
fi

TMPDIR_BASE="$(mktemp -d -t kg-fixture-XXXXXX)"

_cleanup() {
  if [[ "$KEEP" -eq 1 ]]; then
    return 0
  fi
  rm -rf "$TMPDIR_BASE"
}
trap _cleanup EXIT INT TERM

# Layout per research-brief.md §Q3:
#   $TMPDIR_BASE/fake_home/.claude/hive/kg.sqlite
#   $TMPDIR_BASE/proj/.pHive/epics/kg-fixture-local-epic/
#   $TMPDIR_BASE/proj/.pHive/meta-team/charter.md
#   $TMPDIR_BASE/proj/.pHive/metrics/events/   (intentionally empty)
FAKE_HOME="$TMPDIR_BASE/fake_home"
KG_DIR="$FAKE_HOME/.claude/hive"
KG_PATH="$KG_DIR/kg.sqlite"
PROJ_DIR="$TMPDIR_BASE/proj"
LOCAL_EPIC_ID="kg-fixture-local-epic"

mkdir -p "$KG_DIR"
mkdir -p "$PROJ_DIR/.pHive/epics/$LOCAL_EPIC_ID"
mkdir -p "$PROJ_DIR/.pHive/meta-team"
mkdir -p "$PROJ_DIR/.pHive/metrics/events"

cat >"$PROJ_DIR/.pHive/epics/$LOCAL_EPIC_ID/epic.yaml" <<EOF
id: $LOCAL_EPIC_ID
title: Local fixture epic (used by S5 KG seed)
status: active
EOF

cat >"$PROJ_DIR/.pHive/meta-team/charter.md" <<'EOF'
# Meta-team charter (fixture stub)

This stub exists so step-02c §1 can resolve the meta-team context without
failing. The substantive fixture state lives in the tmp kg.sqlite.
EOF

# Seed the tmp kg.sqlite (idempotent — safe on re-run).
sqlite3 "$KG_PATH" < "$SEED_SQL"

# ─── Capture fixture state ───────────────────────────────────────────────
STATE_FILE="$TMPDIR_BASE/fixture-state.txt"
NOW="2026-05-01T00:00:00Z"
RECENT_CUTOFF="2026-04-01T00:00:00Z"  # 30 days before NOW

{
  echo "# kg-augmented-meta-signal fixture state"
  echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# tmp_base:  $TMPDIR_BASE"
  echo "# kg_path:   $KG_PATH"
  echo "# proj_dir:  $PROJ_DIR"
  echo "# local_epic_id: $LOCAL_EPIC_ID"
  echo "# now (logical): $NOW"
  echo "# recent_cutoff: $RECENT_CUTOFF (30d before now)"
  echo
  echo "## Q1: triples by predicate"
  echo "## SQL: SELECT predicate, COUNT(*) FROM triples GROUP BY predicate ORDER BY predicate;"
  sqlite3 -separator $'\t' "$KG_PATH" \
    "SELECT predicate, COUNT(*) FROM triples GROUP BY predicate ORDER BY predicate;"
  echo
  echo "## Q2: triples by recency window (vs cutoff $RECENT_CUTOFF)"
  echo "## SQL: SELECT CASE WHEN valid_from >= '$RECENT_CUTOFF' THEN 'recent' ELSE 'stale' END AS bucket, COUNT(*) FROM triples GROUP BY bucket;"
  sqlite3 -separator $'\t' "$KG_PATH" \
    "SELECT CASE WHEN valid_from >= '$RECENT_CUTOFF' THEN 'recent' ELSE 'stale' END AS bucket, COUNT(*) FROM triples GROUP BY bucket ORDER BY bucket;"
  echo
  echo "## Q3: triples by signal class (local vs cross-project, recent only)"
  echo "## SQL: SELECT CASE WHEN source_epic = '$LOCAL_EPIC_ID' THEN 'local_signal' ELSE 'cross_project_signal' END AS signal, COUNT(*) FROM triples WHERE valid_from >= '$RECENT_CUTOFF' GROUP BY signal;"
  sqlite3 -separator $'\t' "$KG_PATH" \
    "SELECT CASE WHEN source_epic = '$LOCAL_EPIC_ID' THEN 'local_signal' ELSE 'cross_project_signal' END AS signal, COUNT(*) FROM triples WHERE valid_from >= '$RECENT_CUTOFF' GROUP BY signal ORDER BY signal;"
  echo
  echo "## Q4: full triple dump (for tester walk-through)"
  echo "## SQL: SELECT subject, predicate, object, valid_from, source_epic FROM triples ORDER BY valid_from;"
  sqlite3 -header -column "$KG_PATH" \
    "SELECT subject, predicate, object, valid_from, source_epic FROM triples ORDER BY valid_from;"
} > "$STATE_FILE"

echo "FIXTURE-READY"
echo "tmp_base: $TMPDIR_BASE"
echo "state_file: $STATE_FILE"
echo
cat "$STATE_FILE"

if [[ "$KEEP" -eq 1 ]]; then
  echo
  echo "(--keep) tmp dir preserved for inspection: $TMPDIR_BASE"
fi
