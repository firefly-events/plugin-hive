#!/usr/bin/env bash
# stop-interrupt-capture.sh — capture a forced-stop interrupt record.
#
# Resolves the Hive state directory via hooks/common.sh, anchors relative
# paths to HIVE_ROOT, and writes the standard interrupt payload used by the
# Stop hook.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"

state_dir=$(_resolve_state_dir)

interrupt_dir="$state_dir/interrupts"
mkdir -p "$interrupt_dir"

ts=$(date -u +%Y-%m-%dT%H%M%SZ)
printf 'interrupted_at: "%s"\ninterruption_type: forced_stop\nactive_epic: null\nactive_story: null\nactive_step: null\n' "$ts" > "$interrupt_dir/$ts.yaml"
