#!/usr/bin/env bash
# Migration: state/ -> .pHive/
#
# Plugin Hive v1.2+ stores per-project state in .pHive/ instead of state/.
# Run this script from your project root if you have an existing state/
# directory from v1.1.x or earlier.
#
# What this does:
#   1. Verifies state/ exists and .pHive/ does not (no clobber)
#   2. Renames state/ -> .pHive/ (preserves git history if tracked)
#   3. Updates .gitignore (state/* -> .pHive/*)
#   4. Reminds you to commit the move
#
# Usage:
#   bash scripts/migrate-state-to-pHive.sh
#
# Safe to dry-run with: DRY_RUN=1 bash scripts/migrate-state-to-pHive.sh

set -euo pipefail

DRY=${DRY_RUN:-0}

run() {
  if [[ "$DRY" == "1" ]]; then
    echo "[dry-run] $*"
  else
    echo "+ $*"
    eval "$@"
  fi
}

if [[ ! -d state ]]; then
  echo "No state/ directory found in $(pwd) — nothing to migrate."
  exit 0
fi

if [[ -d .pHive ]]; then
  echo "ERROR: .pHive/ already exists. Refusing to clobber."
  echo "Resolve manually:"
  echo "  - If .pHive/ is the migrated copy, delete state/ and you're done."
  echo "  - If both have content, merge them by hand."
  exit 1
fi

echo "Migrating state/ -> .pHive/ in $(pwd)"

# Use git mv if tracked, regular mv otherwise
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git ls-files state/ | head -1 | grep -q .; then
  run "git mv state .pHive"
else
  run "mv state .pHive"
fi

# Update .gitignore if present.
# IMPORTANT: only rewrite anchored Hive-state patterns (^state/, ^!state/) so
# we don't mangle unrelated entries like `test/state/**` or example-project paths.
# We deliberately do NOT touch any line that contains state/ in the middle.
if [[ -f .gitignore ]] && grep -qE '^!?state/' .gitignore; then
  echo "Updating .gitignore patterns (anchored ^state/ and ^!state/ only)"
  if [[ "$DRY" == "1" ]]; then
    echo "[dry-run] sed -E 's|^(!?)state/|\\1.pHive/|' .gitignore"
  else
    cp .gitignore .gitignore.bak
    sed -E 's|^(!?)state/|\1.pHive/|' .gitignore.bak > .gitignore
    rm .gitignore.bak
  fi
fi

# If hive.config.yaml has paths.state_dir, leave it alone (user explicit override).
# Otherwise the default .pHive applies automatically.
if [[ -f hive.config.yaml ]] && grep -q 'state_dir:' hive.config.yaml; then
  echo "Note: hive.config.yaml has paths.state_dir set — review it to ensure it points at .pHive (or your chosen dir)."
fi

cat <<'NEXT'

Migration complete.

Next steps:
  1. Review the changes:    git status
  2. Commit the move:       git add -A && git commit -m "chore: migrate state/ to .pHive/"
  3. Run hive normally — all skills resolve to the new location automatically.

If you prefer to keep using state/ (or a custom directory), set in hive.config.yaml:
  paths:
    state_dir: state    # or any directory name you want
NEXT
