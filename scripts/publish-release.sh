#!/usr/bin/env bash
# Publish the runtime allowlist from the working repo (hive-workshop) into a
# checkout of the release repo (plugin-hive). The release repo ends up containing
# EXACTLY the allowlisted paths — nothing else.
#
# Usage: scripts/publish-release.sh <release-checkout-dir>
#   Run from the working-repo root (or set SRC_OVERRIDE).
set -euo pipefail

SRC="${SRC_OVERRIDE:-$(git rev-parse --show-toplevel)}"
DEST="${1:?usage: publish-release.sh <release-checkout-dir>}"
ALLOW="$SRC/.github/release-allowlist.txt"

[ -f "$ALLOW" ] || { echo "FATAL: allowlist not found at $ALLOW" >&2; exit 1; }
[ -d "$DEST/.git" ] || { echo "FATAL: $DEST is not a git checkout" >&2; exit 1; }

echo "publish: SRC=$SRC DEST=$DEST"

# 1. Wipe everything in the release checkout except .git — the allowlist is authoritative.
find "$DEST" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# 2. Copy each allowlisted path.
copied=0; missing=0
while IFS= read -r raw; do
  p="${raw%%#*}"; p="$(printf '%s' "$p" | xargs 2>/dev/null || true)"
  [ -z "$p" ] && continue
  if [ -e "$SRC/$p" ]; then
    mkdir -p "$DEST/$(dirname "$p")"
    cp -R "$SRC/$p" "$DEST/$(dirname "$p")/"
    copied=$((copied+1))
  else
    echo "  WARN: allowlist path absent in source: $p" >&2
    missing=$((missing+1))
  fi
done < "$ALLOW"

# 3. Drop scripts/tests from the release (maintainer test fixtures, not runtime).
rm -rf "$DEST/scripts/tests" 2>/dev/null || true

echo "publish: copied=$copied missing=$missing"
[ "$copied" -gt 0 ] || { echo "FATAL: nothing copied — refusing to publish empty release" >&2; exit 1; }
