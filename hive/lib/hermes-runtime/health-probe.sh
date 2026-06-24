#!/usr/bin/env bash
# health-probe.sh — multica daemon health check for Studio.
#
# Usage: ./health-probe.sh [--json]
# Exit 0 = healthy, exit 1 = unhealthy.
#
# Consumed by:
#   - watch-cron (hpr-2) to decide whether to skip a tick
#   - Operator restart-recovery check (hpr-5 acceptance criterion)
#
# The probe intentionally has NO side effects. It is safe to run at any cadence.

set -euo pipefail

JSON_MODE=false
if [[ "${1:-}" == "--json" ]]; then
  JSON_MODE=true
fi

# ── 1. Check multica CLI is on PATH ─────────────────────────────────────────
if ! command -v multica &>/dev/null; then
  if $JSON_MODE; then
    printf '{"healthy":false,"reason":"multica CLI not found on PATH"}\n'
  else
    echo "UNHEALTHY: multica CLI not found on PATH" >&2
  fi
  exit 1
fi

# ── 2. Query daemon status ───────────────────────────────────────────────────
STATUS_JSON=$(multica daemon status --output json 2>/dev/null) || {
  if $JSON_MODE; then
    printf '{"healthy":false,"reason":"multica daemon status command failed (daemon not running?)"}\n'
  else
    echo "UNHEALTHY: multica daemon status command failed (daemon may not be running)" >&2
  fi
  exit 1
}

# ── 3. Evaluate status ───────────────────────────────────────────────────────
# The daemon reports a "running" or equivalent field. Treat any non-running
# state as unhealthy.  Use node for JSON parsing to avoid jq dependency.
HEALTHY=$(node -e "
  try {
    const s = JSON.parse($(printf '%s' "$STATUS_JSON" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))"));
    // Accept 'running' or true under common field names.
    const ok = s.running === true || s.status === 'running' || s.state === 'running';
    process.stdout.write(ok ? 'true' : 'false');
  } catch(e) {
    process.stdout.write('false');
  }
" 2>/dev/null) || HEALTHY=false

# Escape STATUS_JSON as a JSON *string* for the unhealthy payload: the daemon
# output may be empty or malformed on the failure path, so interpolating it raw
# would emit invalid JSON and break watch-cron/script consumers.
STATUS_JSON_ESCAPED=$(printf '%s' "$STATUS_JSON" \
  | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))" 2>/dev/null) \
  || STATUS_JSON_ESCAPED='""'

if [[ "$HEALTHY" != "true" ]]; then
  if $JSON_MODE; then
    printf '{"healthy":false,"reason":"daemon reports non-running state","daemon_status_raw":%s}\n' "$STATUS_JSON_ESCAPED"
  else
    echo "UNHEALTHY: daemon reports non-running state"
    echo "daemon status: $STATUS_JSON"
  fi
  exit 1
fi

# ── 4. All checks passed ─────────────────────────────────────────────────────
if $JSON_MODE; then
  printf '{"healthy":true,"daemon_status":%s}\n' "$STATUS_JSON"
else
  echo "HEALTHY: multica daemon is running"
fi
exit 0
