"""Small, dependency-free scanner for YAML ``paths:`` blocks."""

from __future__ import annotations

import re


def scan_paths_block(raw: str, key: str) -> str | None:
    """Return a scalar from a line-oriented YAML ``paths:`` block.

    This narrow fallback is used when a full YAML parser is unavailable or
    cannot parse the input. Inline comments are stripped from the value.
    """
    in_paths = False
    for line in raw.splitlines():
        if re.match(r"^paths:\s*(?:#.*)?$", line):
            in_paths = True
            continue
        if in_paths and re.match(r"^[^\s#][^:]*:", line):
            in_paths = False
        if in_paths:
            match = re.match(rf"^\s+{re.escape(key)}:\s*(.*)$", line)
            if match:
                return re.sub(r"\s*#.*$", "", match.group(1))
    return None
