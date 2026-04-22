"""Tests for the meta-experiment runtime library scaffold."""

from __future__ import annotations

import sys
from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)

REPO_ROOT = Path(__file__).resolve().parents[4]
TOP_LEVEL_TESTS = REPO_ROOT / "tests"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(TOP_LEVEL_TESTS) not in __path__:
    __path__.append(str(TOP_LEVEL_TESTS))
