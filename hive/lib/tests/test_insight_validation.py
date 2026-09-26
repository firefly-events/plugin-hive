"""Tests for the wr-7 override incident-field validator (hive/lib/insight_validation.py).

Covers the AC5 contract enforced at the real distill/promotion boundary:
  (a) a correction/overturned-audit override missing any incident field -> flagged
  (b) a correction/overturned-audit override with all four fields -> passes
  (c) a stale-fact override with no incident fields at all -> exempt
"""

from __future__ import annotations

import pytest

from hive.lib.insight_validation import (
    assert_promotable,
    scan_staging_dir,
    validate_insight_text,
    validate_override_incident_fields,
)

INCOMPLETE_BODY = """
**What happened:** Assumed the config key lived in root hive.config.yaml.
**How detected:** Owner corrected it during review.
**Guardrail:** Check consumer .pHive/hive.config.yaml first next time.
"""

COMPLETE_BODY = """
**What happened:** Assumed the config key lived in root hive.config.yaml.
**How detected:** Owner corrected it during review.
**Correction (verbatim):** "That field only ever lives in consumer .pHive/hive.config.yaml."
**Guardrail:** Check consumer .pHive/hive.config.yaml first next time.
"""

STALE_FACT_BODY = """
The config key moved from hive.config.yaml to .pHive/hive.config.yaml in the
v2 restructure. Consult the new path going forward.
"""


def test_correction_driven_override_missing_field_is_flagged() -> None:
    result = validate_override_incident_fields("override", INCOMPLETE_BODY)

    assert not result.ok
    assert not result.exempt
    assert result.missing == ["Correction (verbatim)"]


def test_correction_driven_override_all_fields_present_passes() -> None:
    result = validate_override_incident_fields("override", COMPLETE_BODY)

    assert result.ok
    assert not result.exempt
    assert result.missing == []


def test_stale_fact_override_without_incident_fields_is_exempt() -> None:
    result = validate_override_incident_fields("override", STALE_FACT_BODY)

    assert result.ok
    assert result.exempt
    assert result.missing == []


def test_non_override_insight_type_is_always_exempt() -> None:
    result = validate_override_incident_fields("pitfall", INCOMPLETE_BODY)

    assert result.ok
    assert result.exempt


def test_validate_insight_text_reads_type_from_frontmatter() -> None:
    text = f"""---
name: bad-override
description: "missing correction field"
type: override
agent: developer
last_verified: 2026-07-19
ttl_days: null
source: agent
---
{INCOMPLETE_BODY}"""

    result = validate_insight_text(text)

    assert not result.ok
    assert result.missing == ["Correction (verbatim)"]


def test_assert_promotable_raises_on_malformed_correction_override() -> None:
    text = f"""---
type: override
---
{INCOMPLETE_BODY}"""

    with pytest.raises(ValueError, match="Correction \\(verbatim\\)"):
        assert_promotable(text, source="staged.md")


def test_assert_promotable_allows_stale_fact_override() -> None:
    text = f"""---
type: override
---
{STALE_FACT_BODY}"""

    assert_promotable(text, source="staged.md")


def test_scan_staging_dir_flags_only_malformed_correction_overrides(tmp_path) -> None:
    epic_dir = tmp_path / "wfd-retro-hardening" / "wr-7-lean-agent-and-incident-refs"
    epic_dir.mkdir(parents=True)

    (epic_dir / "malformed-override.md").write_text(
        f"---\ntype: override\n---\n{INCOMPLETE_BODY}", encoding="utf-8"
    )
    (epic_dir / "complete-override.md").write_text(
        f"---\ntype: override\n---\n{COMPLETE_BODY}", encoding="utf-8"
    )
    (epic_dir / "stale-fact-override.md").write_text(
        f"---\ntype: override\n---\n{STALE_FACT_BODY}", encoding="utf-8"
    )
    (epic_dir / "pitfall.md").write_text(
        f"---\ntype: pitfall\n---\n{INCOMPLETE_BODY}", encoding="utf-8"
    )

    flagged = scan_staging_dir(tmp_path)

    assert [f.path.name for f in flagged] == ["malformed-override.md"]
    assert flagged[0].missing == ["Correction (verbatim)"]


def test_scan_staging_dir_on_missing_directory_returns_empty() -> None:
    assert scan_staging_dir("/nonexistent/path/for/wr-7") == []
