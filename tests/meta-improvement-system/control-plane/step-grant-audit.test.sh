#!/usr/bin/env bash
# Closure-property audit for S4 control-plane rewrite (A2.8)
# Proves: step writes subset team grants, tester/reviewer are read-only,
# Step 8 closure invariant exists, and Steps 4-7 do not write cycle-state inline.

set -euo pipefail
FAILED=0
PASSED=0

pass() { PASSED=$((PASSED + 1)); echo "[PASS] $1"; }
fail() { FAILED=$((FAILED + 1)); echo "[FAIL] $1"; }

REPO_ROOT="/Users/don/Documents/plugin-hive"
TEAMS_DIR="$REPO_ROOT/.pHive/teams"
STEPS_DIR="$REPO_ROOT/hive/workflows/steps/meta-team-cycle"
META_OPTIMIZE_TEAM="$TEAMS_DIR/meta-optimize.yaml"
META_META_TEAM="$TEAMS_DIR/meta-meta-optimize.yaml"
LEGACY_TEAM="$TEAMS_DIR/meta-team.yaml"
WORKFLOW_FILE="$REPO_ROOT/hive/workflows/meta-team-cycle.workflow.yaml"

# Usage: parse_team_members <team-yaml-path>
# Emits: agent|role|path|read|write|delete|agent_line|path_line
parse_team_members() {
  python3 - "$1" <<'PYEOF'
import re
import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
members = []
current_agent = None
current_role = None
current_agent_line = None
in_domain = False
current_path = None
current_read = None
current_write = None
current_delete = None
current_path_line = None

def flush_path():
    global current_path, current_read, current_write, current_delete, current_path_line
    if current_agent is not None and current_path is not None:
        print(
            f"{current_agent}|{current_role or ''}|{current_path}|"
            f"{current_read or ''}|{current_write or ''}|{current_delete or ''}|"
            f"{current_agent_line or 0}|{current_path_line or 0}"
        )
    current_path = None
    current_read = None
    current_write = None
    current_delete = None
    current_path_line = None

for lineno, line in enumerate(lines, start=1):
    m = re.match(r"\s*-\s*agent:\s*(.+?)\s*$", line)
    if m:
        flush_path()
        current_agent = m.group(1).strip()
        current_role = None
        current_agent_line = lineno
        in_domain = False
        continue

    m = re.match(r"\s*role:\s*(.+?)\s*$", line)
    if m and current_agent is not None:
        current_role = m.group(1).strip()
        continue

    if re.match(r"\s*domain:\s*$", line) and current_agent is not None:
        in_domain = True
        continue

    if in_domain and current_agent is not None:
        m = re.match(r"\s*-\s*path:\s*(.+?)\s*$", line)
        if m:
            flush_path()
            current_path = m.group(1).strip().strip('"').strip("'")
            current_path_line = lineno
            continue

        m = re.match(r"\s*read:\s*(true|false)\s*$", line)
        if m and current_path is not None:
            current_read = m.group(1)
            continue

        m = re.match(r"\s*write:\s*(true|false)\s*$", line)
        if m and current_path is not None:
            current_write = m.group(1)
            continue

        m = re.match(r"\s*delete:\s*(true|false)\s*$", line)
        if m and current_path is not None:
            current_delete = m.group(1)
            continue

flush_path()
PYEOF
}

require_file() {
  local path="$1"
  [[ -f "$path" ]] || { echo "missing file: $path" >&2; return 1; }
}

assert_minimum_team_shape() {
  local path="$1"
  require_file "$path"
  python3 - "$path" <<'PYEOF'
import re
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
required = ["name", "members", "team_memory_path"]
missing = [key for key in required if not re.search(rf"(?m)^{re.escape(key)}\s*:", text)]
if missing:
    print(f"{path}: missing required key(s): {', '.join(missing)}", file=sys.stderr)
    raise SystemExit(1)
PYEOF
}

assert_reviewer_tester_read_only() {
  local path="$1"
  python3 - "$path" <<'PYEOF'
import re
import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
current_agent = None
current_agent_line = None
in_domain = False
current_path = None
current_path_line = None

for lineno, line in enumerate(lines, start=1):
    m = re.match(r"\s*-\s*agent:\s*(.+?)\s*$", line)
    if m:
        current_agent = m.group(1).strip()
        current_agent_line = lineno
        in_domain = False
        current_path = None
        current_path_line = None
        continue
    if current_agent is None:
        continue
    if re.match(r"\s*domain:\s*$", line):
        in_domain = True
        continue
    if not in_domain:
        continue
    m = re.match(r"\s*-\s*path:\s*(.+?)\s*$", line)
    if m:
        current_path = m.group(1).strip().strip('"').strip("'")
        current_path_line = lineno
        continue
    m = re.match(r"\s*write:\s*(true|false)\s*$", line)
    if m and current_agent in {"tester", "reviewer"} and m.group(1) == "true":
        print(
            f"{path}:{lineno}: {current_agent} has forbidden write grant on "
            f"{current_path or '<unknown path>'} (member starts line {current_agent_line}, path line {current_path_line})",
            file=sys.stderr,
        )
        raise SystemExit(1)
PYEOF
}

assert_agent_has_write_grant() {
  local path="$1"
  local agent="$2"
  local expected_path="$3"
  local matched=""
  while IFS='|' read -r parsed_agent _ parsed_path _ parsed_write _ _ parsed_line; do
    if [[ "$parsed_agent" == "$agent" && "$parsed_path" == "$expected_path" && "$parsed_write" == "true" ]]; then
      matched="$parsed_line"
      break
    fi
  done < <(parse_team_members "$path")

  [[ -n "$matched" ]] || {
    echo "$path: missing required write grant for agent=$agent path=$expected_path" >&2
    return 1
  }
}

assert_all_paths_scoped_to_project_root() {
  local path="$1"
  python3 - "$path" <<'PYEOF'
import re
import sys

path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
current_agent = None
for lineno, line in enumerate(lines, start=1):
    m = re.match(r"\s*-\s*agent:\s*(.+?)\s*$", line)
    if m:
        current_agent = m.group(1).strip()
        continue
    m = re.match(r"\s*-\s*path:\s*(.+?)\s*$", line)
    if m:
        grant = m.group(1).strip().strip('"').strip("'")
        if not grant.startswith("{project_root}/"):
            print(
                f"{path}:{lineno}: agent={current_agent or '<unknown>'} has out-of-scope grant path {grant}; expected prefix {{project_root}}/",
                file=sys.stderr,
            )
            raise SystemExit(1)
PYEOF
}

assert_file_contains_case_insensitive() {
  local path="$1"
  local pattern="$2"
  python3 - "$path" "$pattern" <<'PYEOF'
import re
import sys

path, pattern = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
if not re.search(pattern, text, re.IGNORECASE):
    print(f"{path}: missing required pattern /{pattern}/i", file=sys.stderr)
    raise SystemExit(1)
PYEOF
}

assert_step_has_no_inline_cycle_state_write() {
  local path="$1"
  python3 - "$path" <<'PYEOF'
import re
import sys

path = sys.argv[1]
patterns = [
    re.compile(r"Append to\s+\.pHive/.+cycle-state\.yaml"),
    re.compile(r"Update cycle-state\.yaml"),
    re.compile(r"Write to\s+\.pHive/.+cycle-state\.yaml"),
]
for lineno, line in enumerate(open(path, encoding="utf-8").read().splitlines(), start=1):
    for pattern in patterns:
        if pattern.search(line):
            print(f"{path}:{lineno}: forbidden inline cycle-state write instruction: {line.strip()}", file=sys.stderr)
            raise SystemExit(1)
PYEOF
}

echo "=== step-grant-audit tests ==="

# Property 1: team files exist and are well-formed
if assert_minimum_team_shape "$META_OPTIMIZE_TEAM"; then
  pass "meta-optimize team file exists with minimum required keys"
else
  fail "meta-optimize team file exists with minimum required keys"
fi

if assert_minimum_team_shape "$META_META_TEAM"; then
  pass "meta-meta-optimize team file exists with minimum required keys"
else
  fail "meta-meta-optimize team file exists with minimum required keys"
fi

if require_file "$LEGACY_TEAM" && grep -q "RETIRED" "$LEGACY_TEAM"; then
  pass "legacy meta-team file exists and contains RETIRED tombstone"
else
  fail "legacy meta-team file exists and contains RETIRED tombstone"
fi

# Property 2: tester and reviewer have no write grants in either swarm
if assert_reviewer_tester_read_only "$META_OPTIMIZE_TEAM"; then
  pass "meta-optimize tester and reviewer grants are read-only"
else
  fail "meta-optimize tester and reviewer grants are read-only"
fi

if assert_reviewer_tester_read_only "$META_META_TEAM"; then
  pass "meta-meta-optimize tester and reviewer grants are read-only"
else
  fail "meta-meta-optimize tester and reviewer grants are read-only"
fi

# Property 3: developer write grants include required Step 4 maintainer paths
for expected in \
  "hive/references/**" \
  "hive/agents/**" \
  "hive/workflows/**" \
  "skills/hive/agents/memories/**" \
  ".pHive/teams/**"
do
  if assert_agent_has_write_grant "$META_META_TEAM" "developer" "$expected"; then
    pass "meta-meta developer write grant covers $expected"
  else
    fail "meta-meta developer write grant covers $expected"
  fi
done

# Property 4: orchestrator owns Step 8 lifecycle write path
if assert_agent_has_write_grant "$META_META_TEAM" "orchestrator" ".pHive/meta-meta-optimize/**"; then
  pass "meta-meta orchestrator write grant covers Step 8 lifecycle path"
else
  fail "meta-meta orchestrator write grant covers Step 8 lifecycle path"
fi

# Property 5: public swarm grant scope stays under {project_root}/
if assert_all_paths_scoped_to_project_root "$META_OPTIMIZE_TEAM"; then
  pass "meta-optimize grants are all scoped under {project_root}/"
else
  fail "meta-optimize grants are all scoped under {project_root}/"
fi

# Property 6: Step 8 closure invariant still exists
if assert_file_contains_case_insensitive "$STEPS_DIR/step-08-close.md" "non-bypassable"; then
  pass "Step 8 marks the closure invariant as non-bypassable"
else
  fail "Step 8 marks the closure invariant as non-bypassable"
fi

if assert_file_contains_case_insensitive "$STEPS_DIR/step-08-close.md" "commit_ref" \
  && assert_file_contains_case_insensitive "$STEPS_DIR/step-08-close.md" "metrics_snapshot" \
  && assert_file_contains_case_insensitive "$STEPS_DIR/step-08-close.md" "rollback_ref"; then
  pass "Step 8 names commit_ref, metrics_snapshot, and rollback_ref"
else
  fail "Step 8 names commit_ref, metrics_snapshot, and rollback_ref"
fi

if assert_file_contains_case_insensitive "$STEPS_DIR/step-08-close.md" "git rev-parse --verify"; then
  pass "Step 8 references git rev-parse --verify"
else
  fail "Step 8 references git rev-parse --verify"
fi

# Property 7: Steps 4-7 do not write cycle-state inline
for step in \
  "$STEPS_DIR/step-04-implementation.md" \
  "$STEPS_DIR/step-05-testing.md" \
  "$STEPS_DIR/step-06-evaluation.md" \
  "$STEPS_DIR/step-07-promotion.md"
do
  if assert_step_has_no_inline_cycle_state_write "$step"; then
    pass "$(basename "$step") has no inline cycle-state write instruction"
  else
    fail "$(basename "$step") has no inline cycle-state write instruction"
  fi
done

# Property 8: Step 5 tester contract is explicitly read-only
if assert_file_contains_case_insensitive "$STEPS_DIR/step-05-testing.md" "Read-only access|this step is read-only|do NOT modify any files"; then
  pass "Step 5 declares the tester contract as read-only"
else
  fail "Step 5 declares the tester contract as read-only"
fi

# Property 9: negative-case proof
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

bad_team="$tmp_dir/meta-meta-optimize.bad.yaml"
cat >"$bad_team" <<'EOF'
name: meta-meta-optimize
members:
  - agent: tester
    role: Validation
    domain:
      - path: hive/references/**
        read: true
        write: true
        delete: false
team_memory_path: .pHive/team-memories/meta-meta-optimize/
EOF

if bad_output="$(assert_reviewer_tester_read_only "$bad_team" 2>&1)"; then
  fail "negative case: tester write grant drift must be rejected"
elif [[ "$bad_output" == *"tester has forbidden write grant on hive/references/**"* ]]; then
  pass "negative case: tester write grant drift is caught with specific path message"
else
  fail "negative case: tester write grant drift is caught with specific path message"
  echo "$bad_output" >&2
fi

bad_step="$tmp_dir/step-05-testing.bad.md"
cat >"$bad_step" <<'EOF'
# Step 5: Testing

Append to .pHive/meta-meta-optimize/cycle-state.yaml:
- status: invalid
EOF

if bad_output="$(assert_step_has_no_inline_cycle_state_write "$bad_step" 2>&1)"; then
  fail "negative case: inline cycle-state write drift must be rejected"
elif [[ "$bad_output" == *"forbidden inline cycle-state write instruction"* && "$bad_output" == *".pHive/meta-meta-optimize/cycle-state.yaml"* ]]; then
  pass "negative case: inline cycle-state write drift is caught with specific file and path message"
else
  fail "negative case: inline cycle-state write drift is caught with specific file and path message"
  echo "$bad_output" >&2
fi

echo ""
echo "=== Result: $PASSED passed, $FAILED failed ==="
[[ $FAILED -eq 0 ]] || exit 1
