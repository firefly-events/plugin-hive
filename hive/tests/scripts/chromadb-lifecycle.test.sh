#!/usr/bin/env bash
# ChromaDB sidecar lifecycle script tests.

set -u

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
START="$REPO_ROOT/hive/scripts/chromadb-start.sh"
STOP="$REPO_ROOT/hive/scripts/chromadb-stop.sh"
STATUS="$REPO_ROOT/hive/scripts/chromadb-status.sh"

PASS=0
FAIL=0
SKIP=0
TMPDIR_BASE=$(mktemp -d)
ORIGINAL_PATH="$PATH"

trap 'HOME="$TMPDIR_BASE/home" bash "$STOP" >/dev/null 2>&1 || true; rm -rf "$TMPDIR_BASE"' EXIT

pass() { printf 'PASS: %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL: %s\n' "$1"; FAIL=$((FAIL + 1)); }
skip() { printf 'SKIP: %s\n' "$1"; SKIP=$((SKIP + 1)); }

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "$actual" == "$expected" ]]; then
    pass "$label"
  else
    fail "$label (expected '$expected', got '$actual')"
  fi
}

assert_file_mode_600() {
  local path="$1"
  local label="$2"
  local mode
  mode=$(stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null || true)
  if [[ "$mode" == "600" ]]; then
    pass "$label"
  else
    fail "$label (mode '$mode')"
  fi
}

make_fake_chroma() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/chroma" <<'SH'
#!/usr/bin/env bash
if [[ "$1" != "run" ]]; then
  exit 2
fi
printf 'Running Chroma at http://127.0.0.1:54321\n'
trap 'exit 0' TERM INT
while true; do
  sleep 1
done
SH
  chmod +x "$bin_dir/chroma"
}

reset_home() {
  local name="$1"
  export HOME="$TMPDIR_BASE/$name"
  rm -rf "$HOME"
  mkdir -p "$HOME"
}

echo "=== syntax ==="
if bash -n "$START" && bash -n "$STOP" && bash -n "$STATUS"; then
  pass "scripts pass bash -n"
else
  fail "scripts pass bash -n"
fi

echo ""
echo "=== functional: start/status/stop with fake chroma ==="
reset_home "home-functional"
FAKE_BIN="$TMPDIR_BASE/fake-bin"
make_fake_chroma "$FAKE_BIN"
export PATH="$FAKE_BIN:$ORIGINAL_PATH"

start_begin=$(date +%s)
start_output=$(bash "$START" 2>&1)
start_rc=$?
start_elapsed=$(( $(date +%s) - start_begin ))

if [[ "$start_rc" -eq 0 ]]; then
  pass "start exits 0"
else
  fail "start exits 0 (rc=$start_rc output=$start_output)"
fi

if [[ "$start_elapsed" -lt 5 ]]; then
  pass "start returns within 5 seconds (${start_elapsed}s)"
else
  fail "start returns within 5 seconds (${start_elapsed}s)"
fi

STATE="$HOME/.claude/hive"
assert_eq "54321" "$(cat "$STATE/chromadb.port" 2>/dev/null || true)" "start writes parsed port"
if [[ -s "$STATE/chromadb.pid" ]]; then pass "start writes pid"; else fail "start writes pid"; fi
if [[ -f "$STATE/chromadb.lock" ]]; then pass "start writes lockfile"; else fail "start writes lockfile"; fi
assert_file_mode_600 "$STATE/chromadb.port" "port file mode is 600"
assert_file_mode_600 "$STATE/chromadb.pid" "pid file mode is 600"
assert_file_mode_600 "$STATE/chromadb.lock" "lock file mode is 600"

status_output=$(bash "$STATUS" 2>/dev/null)
status_rc=$?
assert_eq "running" "$status_output" "status reports running"
assert_eq "0" "$status_rc" "running status exits 0"

second_begin=$(date +%s)
second_output=$(bash "$START" 2>&1)
second_elapsed=$(( $(date +%s) - second_begin ))
if [[ "$second_output" == *"already running"* && "$second_elapsed" -lt 5 ]]; then
  pass "second start fast-paths existing instance"
else
  fail "second start fast-paths existing instance (elapsed=${second_elapsed}s output=$second_output)"
fi

stop_output=$(bash "$STOP" 2>&1)
assert_eq "stopped" "$stop_output" "stop reports stopped"
status_output=$(bash "$STATUS" 2>/dev/null)
status_rc=$?
assert_eq "stopped" "$status_output" "status reports stopped"
assert_eq "1" "$status_rc" "stopped status exits 1"

echo ""
echo "=== negative: stale/corrupted lockfile recovery ==="
reset_home "home-stale"
export PATH="$FAKE_BIN:$ORIGINAL_PATH"
mkdir -p "$HOME/.claude/hive"
printf 'not-a-real-lock\n' > "$HOME/.claude/hive/chromadb.lock"
printf '999999\n' > "$HOME/.claude/hive/chromadb.pid"
printf '11111\n' > "$HOME/.claude/hive/chromadb.port"
chmod 600 "$HOME/.claude/hive/chromadb.lock" "$HOME/.claude/hive/chromadb.pid" "$HOME/.claude/hive/chromadb.port"

status_output=$(bash "$STATUS" 2>/dev/null)
status_rc=$?
assert_eq "stale-lockfile" "$status_output" "status reports stale-lockfile"
assert_eq "2" "$status_rc" "stale-lockfile status exits 2"

start_output=$(bash "$START" 2>&1)
if [[ "$start_output" == *"started chromadb"* ]] && [[ "$(cat "$HOME/.claude/hive/chromadb.port")" == "54321" ]]; then
  pass "start clears stale state and launches"
else
  fail "start clears stale state and launches (output=$start_output)"
fi
HOME="$HOME" bash "$STOP" >/dev/null 2>&1 || true

echo ""
echo "=== negative: missing chroma binary ==="
reset_home "home-missing"
export PATH="/usr/bin:/bin"
if command -v chroma >/dev/null 2>&1; then
  skip "missing chroma warning path because chroma is present in restricted PATH"
else
  missing_output=$(bash "$START" 2>&1)
  missing_rc=$?
  if [[ "$missing_rc" -eq 0 && "$missing_output" == *"warning:"*"chroma binary not found"* ]]; then
    pass "missing chroma exits 0 with warning"
  else
    fail "missing chroma exits 0 with warning (rc=$missing_rc output=$missing_output)"
  fi
fi

echo ""
echo "=== integration: status all states ==="
reset_home "home-status"
status_output=$(bash "$STATUS" 2>/dev/null)
status_rc=$?
assert_eq "stopped" "$status_output" "fresh status is stopped"
assert_eq "1" "$status_rc" "fresh stopped exits 1"

mkdir -p "$HOME/.claude/hive"
printf 'stale\n' > "$HOME/.claude/hive/chromadb.lock"
chmod 600 "$HOME/.claude/hive/chromadb.lock"
status_output=$(bash "$STATUS" 2>/dev/null)
status_rc=$?
assert_eq "stale-lockfile" "$status_output" "lock-only status is stale"
assert_eq "2" "$status_rc" "lock-only stale exits 2"

rm -f "$HOME/.claude/hive/chromadb.lock"
export PATH="$FAKE_BIN:$ORIGINAL_PATH"
bash "$START" >/dev/null 2>&1
status_output=$(bash "$STATUS" 2>/dev/null)
status_rc=$?
assert_eq "running" "$status_output" "live status is running"
assert_eq "0" "$status_rc" "live running exits 0"
bash "$STOP" >/dev/null 2>&1 || true

echo ""
echo "=== summary ==="
printf 'pass=%s fail=%s skip=%s\n' "$PASS" "$FAIL" "$SKIP"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
