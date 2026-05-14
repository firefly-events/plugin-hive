#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/register project space.XXXXXX")"
PROJECT_DIR="$TMP_ROOT/Nail Tech Assitant"
REGISTRY="$TMP_ROOT/projects.yaml"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$PROJECT_DIR/.pHive/cycle-state"
cat > "$PROJECT_DIR/.pHive/cycle-state/sample.yaml" <<'YAML'
epic: path-with-space-test
phase: complete
YAML

HIVE_PROJECTS_REGISTRY="$REGISTRY" \
  node "$ROOT_DIR/skills/hive/skills/register-project/register-project.mjs" \
  "$PROJECT_DIR" \
  --name nail-tech-assistant >/tmp/register-project-path-space.out

CANONICAL="$(cd "$PROJECT_DIR" && pwd -P)"

grep -q 'name: "nail-tech-assistant"' "$REGISTRY"
grep -q "path: \"$CANONICAL\"" "$REGISTRY"
grep -q 'registered_at:' "$REGISTRY"

echo "pass: quoted path with space registered at $CANONICAL"
