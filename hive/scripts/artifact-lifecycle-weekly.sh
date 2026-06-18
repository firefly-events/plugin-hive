#!/usr/bin/env bash
# Weekly wrapper — invokes the Python artifact lifecycle CLI.
# All sweep logic, safety, dry-run/apply behavior, class filtering, hard
# exclusions, and active guards are owned by the CLI; this script only
# triggers it and captures failures.
#
# Manual invocation:
#   ./hive/scripts/artifact-lifecycle-weekly.sh [--dry-run] [--class <id>]
#
# Scheduled invocation (launchd/cron) calls the same script without extra
# flags, which runs in report mode (no evictions).  To actually evict, pass
# --apply.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

LOG_DIR="${HIVE_ARTIFACT_LOG_DIR:-${REPO_ROOT}/.pHive/logs}"
LOG_FILE="${LOG_DIR}/artifact-lifecycle-weekly.log"
mkdir -p "${LOG_DIR}"

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

log() {
  echo "[${TIMESTAMP}] $*" | tee -a "${LOG_FILE}"
}

log "artifact-lifecycle-weekly: starting"

# Pass all arguments through to the CLI so operators can supply --dry-run,
# --apply, --class, etc. without modifying this script.
cd "${REPO_ROOT}"
if python -m hive.lib.artifact_lifecycle "$@"; then
  log "artifact-lifecycle-weekly: completed successfully"
else
  EXIT_CODE=$?
  log "artifact-lifecycle-weekly: CLI exited ${EXIT_CODE} — see above for details"
  # Do not execute any fallback deletion logic; the CLI exit code is authoritative.
  exit "${EXIT_CODE}"
fi
