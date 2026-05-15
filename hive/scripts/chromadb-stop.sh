#!/usr/bin/env bash
# Stop the optional ChromaDB sidecar and remove lifecycle state files.

set -u

STATE_DIR="${HOME}/.claude/hive"
LOCK_FILE="${STATE_DIR}/chromadb.lock"
PID_FILE="${STATE_DIR}/chromadb.pid"
PORT_FILE="${STATE_DIR}/chromadb.port"
LOCK_DIR="${STATE_DIR}/chromadb.lockdir"

is_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -dc '0-9' < "$PID_FILE"
  fi
}

cleanup_state() {
  rm -f "$PORT_FILE" "$PID_FILE" "$LOCK_FILE"
  rm -rf "$LOCK_DIR"
}

main() {
  local pid
  pid="$(read_pid)"

  if [[ -n "$pid" ]] && is_pid_alive "$pid"; then
    kill -TERM "$pid" 2>/dev/null || true
    local deadline=$((SECONDS + 2))
    while [[ $SECONDS -lt $deadline ]]; do
      is_pid_alive "$pid" || break
      sleep 0.1
    done
    if is_pid_alive "$pid"; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi

  cleanup_state
  printf 'stopped\n'
}

main "$@"
