"""hde-9a — shipped baseline integrity check (belt-and-suspenders).

The CI guard at `.github/workflows/ci.yml::config-guard` fails any PR
that adds a top-level `executor:` key to `hive/hive.config.yaml`. This
test mirrors that guard at the test-suite level so a developer who runs
`pytest` locally catches the same regression before pushing.

Defends against the eefbff3 / `project_config_shipping_deferred` pattern
where maintainer-only flags accidentally landed in the shipped baseline.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SHIPPED_CONFIG = REPO_ROOT / "hive" / "hive.config.yaml"


def test_shipped_config_exists() -> None:
    assert SHIPPED_CONFIG.is_file(), (
        f"shipped baseline missing: {SHIPPED_CONFIG}"
    )


def test_shipped_config_has_no_top_level_executor_key() -> None:
    """The hde-9a Q4 lock: `executor:` belongs in `.pHive/hive.config.yaml`
    (consumer-side), NEVER in the shipped baseline. A future maintainer
    who edits `hive/hive.config.yaml` to add an executor flag must hit
    this assertion before the change reaches CI.
    """

    text = SHIPPED_CONFIG.read_text(encoding="utf-8")
    pattern = re.compile(r"^\s*executor:", re.MULTILINE)
    matches = pattern.findall(text)
    assert not matches, (
        f"hive/hive.config.yaml contains top-level 'executor:' key — this is "
        f"the eefbff3 accidental-ship pattern (Q4 lock). Move the key to "
        f"`.pHive/hive.config.yaml` (consumer-side). Found {len(matches)} match(es)."
    )
