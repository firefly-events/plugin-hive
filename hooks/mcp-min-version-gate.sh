#!/usr/bin/env bash

# SessionStart host ABI shim. Policy ownership and numeric comparison live in
# the Python-first compatibility module.
HIVE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CURRENT="$(claude --version 2>/dev/null || true)"
exec python3 "$HIVE_ROOT/hive/lib/claude_code_compat.py" check "$CURRENT"
