"""Top-level unittest discovery package."""

from __future__ import annotations

from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)

META_EXPERIMENT_TESTS = Path(__file__).resolve().parent.parent / "hive/lib/meta-experiment/tests"
if str(META_EXPERIMENT_TESTS) not in __path__:
    __path__.append(str(META_EXPERIMENT_TESTS))
