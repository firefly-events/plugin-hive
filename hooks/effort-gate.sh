#!/usr/bin/env bash
# effort-gate.sh — resolve the session effort tier and persist it.
#
# Resolution precedence: $CLAUDE_EFFORT env > existing
# .pHive/session-effort.txt > default `medium`. Accepted tiers: low | medium |
# high | xhigh (`max` normalizes to `xhigh`). Unrecognized values fall back to
# `medium` with a logged warning. Never fails the session — always exit 0.

set +e
set -u

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"
set +e

state_dir=$(_resolve_state_dir)
mkdir -p "$state_dir"
effort_file="$state_dir/session-effort.txt"

effort="${CLAUDE_EFFORT:-}"

if [[ -z "$effort" && -f "$effort_file" ]]; then
  effort=$(cat "$effort_file" 2>/dev/null)
fi

effort="${effort:-medium}"
effort="$(printf '%s' "$effort" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"

case "$effort" in
  max)
    effort="xhigh"
    ;;
  low|medium|high|xhigh)
    ;;
  *)
    echo "effort-gate: unrecognized CLAUDE_EFFORT value '$effort', defaulting to medium" >&2
    effort="medium"
    ;;
esac

printf '%s' "$effort" > "$effort_file"

exit 0
