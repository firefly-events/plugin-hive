#!/usr/bin/env bash
# Report ChromaDB sidecar lifecycle state.

set -u

STATE_DIR="${HOME}/.claude/hive"
LOCK_FILE="${STATE_DIR}/chromadb.lock"
PID_FILE="${STATE_DIR}/chromadb.pid"
PORT_FILE="${STATE_DIR}/chromadb.port"

is_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -dc '0-9' < "$PID_FILE"
  fi
}

main() {
  local pid
  pid="$(read_pid)"

  if [[ -n "$pid" ]] && is_pid_alive "$pid" && [[ -f "$PORT_FILE" ]]; then
    printf 'running\n'
    return 0
  fi

  if [[ -f "$LOCK_FILE" ]]; then
    printf 'stale-lockfile\n'
    return 2
  fi

  printf 'stopped\n'
  return 1
}

main "$@"
