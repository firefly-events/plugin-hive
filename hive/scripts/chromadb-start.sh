#!/usr/bin/env bash
# Start the optional ChromaDB sidecar without blocking session startup.

set -u

STATE_DIR="${HOME}/.claude/hive"
LOCK_FILE="${STATE_DIR}/chromadb.lock"
PID_FILE="${STATE_DIR}/chromadb.pid"
PORT_FILE="${STATE_DIR}/chromadb.port"
LOG_FILE="${STATE_DIR}/chromadb.log"
LOCK_DIR="${STATE_DIR}/chromadb.lockdir"
START_TIMEOUT_SECONDS="${CHROMADB_START_CAPTURE_SECONDS:-3}"

warn() {
  printf 'warning: %s\n' "$*" >&2
}

ensure_state_dir() {
  mkdir -p "$STATE_DIR" || return 1
  chmod 700 "$STATE_DIR" 2>/dev/null || true
  touch "$LOCK_FILE" || return 1
  chmod 600 "$LOCK_FILE" 2>/dev/null || true
}

is_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -dc '0-9' < "$PID_FILE"
  fi
}

read_port() {
  if [[ -f "$PORT_FILE" ]]; then
    tr -dc '0-9' < "$PORT_FILE"
  fi
}

heartbeat_available() {
  local port="$1"
  [[ -n "$port" ]] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  curl --silent --fail --max-time 0.5 "http://127.0.0.1:${port}/api/v1/heartbeat" >/dev/null 2>&1
}

clear_state() {
  rm -f "$PID_FILE" "$PORT_FILE" "$LOCK_FILE"
  rm -rf "$LOCK_DIR"
}

fast_exit_if_running() {
  local pid port
  pid="$(read_pid)"
  port="$(read_port)"

  if [[ -n "$port" ]] && heartbeat_available "$port"; then
    printf 'already running\n'
    return 0
  fi

  if [[ -n "$pid" ]] && is_pid_alive "$pid" && [[ -f "$PORT_FILE" ]]; then
    printf 'already running\n'
    return 0
  fi

  return 1
}

clear_stale_lock_if_needed() {
  local pid
  pid="$(read_pid)"
  if [[ -f "$LOCK_FILE" ]] && { [[ -z "$pid" ]] || ! is_pid_alive "$pid"; }; then
    rm -f "$PID_FILE" "$PORT_FILE" "$LOCK_FILE"
    rm -rf "$LOCK_DIR"
    touch "$LOCK_FILE" || return 1
    chmod 600 "$LOCK_FILE" 2>/dev/null || true
  fi
}

extract_port_from_log() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 1
  fi

  awk '
    match($0, /(127\.0\.0\.1|localhost|0\.0\.0\.0):[0-9]+/) {
      port = substr($0, RSTART, RLENGTH)
      sub(/^.*:/, "", port)
      print port
      exit
    }
    match($0, /port[[:space:]]+[0-9]+/) {
      port = substr($0, RSTART, RLENGTH)
      sub(/^port[[:space:]]+/, "", port)
      print port
      exit
    }
  ' "$LOG_FILE"
}

record_file() {
  local path="$1"
  local value="$2"
  printf '%s\n' "$value" > "$path" || return 1
  chmod 600 "$path" 2>/dev/null || true
}

launch_chroma() {
  if ! command -v chroma >/dev/null 2>&1; then
    warn "chroma binary not found; install with 'pip install chromadb' or 'pipx install chromadb'"
    return 0
  fi

  : > "$LOG_FILE"
  chmod 600 "$LOG_FILE" 2>/dev/null || true

  chroma run --port 0 >> "$LOG_FILE" 2>&1 &
  local pid=$!
  record_file "$PID_FILE" "$pid" || warn "could not write $PID_FILE"

  local port=""
  local deadline=$((SECONDS + START_TIMEOUT_SECONDS))
  while [[ $SECONDS -lt $deadline ]]; do
    port="$(extract_port_from_log || true)"
    if [[ -n "$port" ]]; then
      record_file "$PORT_FILE" "$port" || warn "could not write $PORT_FILE"
      printf 'started chromadb pid=%s port=%s\n' "$pid" "$port"
      return 0
    fi
    if ! is_pid_alive "$pid"; then
      warn "chroma exited before reporting a port; see $LOG_FILE"
      return 0
    fi
    sleep 0.1
  done

  warn "chroma started as pid $pid but did not report a port within ${START_TIMEOUT_SECONDS}s; see $LOG_FILE"
  return 0
}

main() {
  ensure_state_dir || {
    warn "could not create $STATE_DIR"
    return 0
  }

  if fast_exit_if_running; then
    return 0
  fi

  clear_stale_lock_if_needed || true

  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    chmod 600 "$LOCK_FILE" 2>/dev/null || true
    if ! flock -n 9; then
      printf 'already starting\n'
      return 0
    fi
    fast_exit_if_running && return 0
    launch_chroma
    return 0
  fi

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    printf 'already starting\n'
    return 0
  fi
  trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT
  fast_exit_if_running && return 0
  launch_chroma
  return 0
}

main "$@"
