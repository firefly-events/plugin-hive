#!/usr/bin/env bash
# common.sh — shared Hive hook helpers.
#
# The authoritative resolver for paths.state_dir and paths.target_project from
# the ROOT hive.config.yaml (the consumer override layer). Shipped skills,
# hooks, and workflows should source this file and call _read_paths_config()
# or the per-key convenience helpers rather than reading the config directly.
#
# Usage (from another hook):
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   HIVE_ROOT="${HIVE_ROOT:-$(dirname "$SCRIPT_DIR")}"
#   . "$HIVE_ROOT/hooks/common.sh"
#   state_dir=$(_resolve_state_dir)
#   target_project=$(_resolve_target_project)
#
# Pattern: source-and-resolve-at-use (Pattern B). No pre-hook sequencing; a
# cold hook invocation gets a correct answer on its first call.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIVE_ROOT="${HIVE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

_canonicalize_path() {
  local path="$1"
  local resolved=""

  if command -v realpath &>/dev/null; then
    if resolved=$(realpath -m "$path" 2>/dev/null); then
      echo "$resolved"
      return
    fi
    if resolved=$(realpath "$path" 2>/dev/null); then
      echo "$resolved"
      return
    fi
  fi

  if command -v readlink &>/dev/null; then
    if resolved=$(readlink -f "$path" 2>/dev/null); then
      echo "$resolved"
      return
    fi
  fi

  local abs_path="$path"
  if [[ "$abs_path" != /* ]]; then
    abs_path="$PWD/$abs_path"
  fi

  local dir_path="${abs_path%/*}"
  local base_name="${abs_path##*/}"

  if [[ -d "$dir_path" ]]; then
    if resolved=$(cd "$dir_path" 2>/dev/null && pwd -P); then
      echo "${resolved%/}/$base_name"
      return
    fi
  fi

  echo "$abs_path"
}

_read_paths_config() {
  local key="$1"
  local default="$2"
  local config_path="${CONFIG_FILE:-$HIVE_ROOT/hive.config.yaml}"
  local val=""

  if [[ ! -f "$config_path" ]]; then
    echo "$default"
    return
  fi

  if command -v yq &>/dev/null; then
    val=$(yq -r ".paths.${key}" "$config_path" 2>/dev/null || true)
  fi

  if [[ -z "${val:-}" ]] && command -v python3 &>/dev/null; then
    val=$(python3 - "$config_path" "$key" <<'PYEOF'
import sys
try:
    import yaml
    with open(sys.argv[1], encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    value = (config.get("paths") or {}).get(sys.argv[2], "")
    if value is not None:
        print(str(value))
except Exception:
    pass
PYEOF
    2>/dev/null || true)
  fi

  if [[ -z "${val:-}" ]]; then
    val=$(awk -v key="$key" '
      /^paths:[[:space:]]*$/ { in_paths=1; next }
      in_paths && /^[^[:space:]#][^:]*:/ { in_paths=0 }
      in_paths && $0 ~ "^[[:space:]]+" key ":[[:space:]]*" {
        sub("^[[:space:]]+" key ":[[:space:]]*", "", $0)
        print
        exit
      }
    ' "$config_path")
  fi

  val=$(printf '%s' "${val:-}" | awk '
    NR == 1 {
      sub(/^[[:space:]]+/, "", $0)
      sub(/[[:space:]]+$/, "", $0)
      if (($0 ~ /^".*"$/) || ($0 ~ /^'\''.*'\''$/)) {
        $0 = substr($0, 2, length($0) - 2)
      }
      print
    }
  ')

  if [[ -z "${val:-}" ]] || [[ "$val" == "null" ]]; then
    echo "$default"
  else
    echo "$val"
  fi
}

_resolve_state_dir() {
  local state_dir=""
  local target_project=""

  state_dir=$(_read_paths_config "state_dir" ".pHive")
  if [[ "$state_dir" == /* ]]; then
    _canonicalize_path "$state_dir"
    return
  fi

  target_project=$(_resolve_target_project)
  _canonicalize_path "$target_project/$state_dir"
}

_resolve_target_project() {
  local target_project=""
  target_project=$(_read_paths_config "target_project" "")
  if [[ -z "$target_project" ]]; then
    echo "$PWD"
  elif [[ "$target_project" == /* ]]; then
    _canonicalize_path "$target_project"
  else
    _canonicalize_path "$PWD/$target_project"
  fi
}
