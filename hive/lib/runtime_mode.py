"""hive/lib/runtime_mode.py

Detects whether the current Hive skill invocation is running interactively
(a human is present, AskUserQuestion is usable) or headlessly (driven by an
orchestrator via `claude -p`, no human present). Dual-implemented with
runtime_mode.js per this package's existing config.py/config.js convention.

Precedence (env > CI > default), matching the env > config > default idiom
used elsewhere in this repo (see planning.mode resolution):
  1. HIVE_HEADLESS=1 forces headless; HIVE_HEADLESS=0 forces interactive.
  2. CI=true is treated as headless.
  3. Default: interactive.

Deliberately no TTY-probe tier — a Bash-tool subprocess's stdio does not
reliably reflect whether a human is present in the calling session, and using
it risks misclassifying sessions in either direction. See
.pHive/epics/headless-question-protocol/docs/grill-record.md finding H1.
"""

from __future__ import annotations

import os
from typing import Mapping, TypedDict


class RuntimeMode(TypedDict):
    mode: str  # "interactive" | "headless"
    source: str  # "env" | "ci" | "default"


def detect_interactive_mode(env: Mapping[str, str] | None = None) -> RuntimeMode:
    environ = env if env is not None else os.environ

    headless_override = environ.get("HIVE_HEADLESS")
    if headless_override == "1":
        return {"mode": "headless", "source": "env"}
    if headless_override == "0":
        return {"mode": "interactive", "source": "env"}

    if environ.get("CI") == "true":
        return {"mode": "headless", "source": "ci"}

    return {"mode": "interactive", "source": "default"}
