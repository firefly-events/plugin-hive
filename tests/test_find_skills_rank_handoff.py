"""Tests for /find-skills ranking + threshold + handoff (story se-5).

The story's worker-contract YAML names the file
``tests/find-skills-rank-handoff.test.js``, but the underlying helper is
Python (``hive/lib/skill_candidate_rank.py``) and the established
project convention for Python helpers is ``python -m unittest discover
tests``. Sister story se-4 set the precedent — see
``tests/test_skill_candidate_mining.py:1-15`` for the same path
divergence and its rationale. The story description (acceptance
criteria) is the binding source; the file extension in ``files_to_modify``
is informational. The test therefore lives in Python under ``tests/``
to match the helper it exercises.

Each acceptance criterion has at least one dedicated test method:

- AC-1 (10 observations → 6 ranked candidates with name/triggers/scope_hint)
  -> ``TestAcceptanceOne``
- AC-2 (empty observations OR all-below-threshold → single-key yaml,
        no noise rows)
  -> ``TestAcceptanceTwoEmptyShape`` (two sub-cases)
- AC-3 (hand-off invokes /write-skill via Skill atomic external call)
  -> ``TestAcceptanceThreeHandoffWiring`` (doc-as-contract grep)
- AC-4 (composed brief references recent_examples — proves chain wired)
  -> ``TestAcceptanceFourRecentExamplesReferenced``
"""

from __future__ import annotations

import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hive.lib import skill_candidate_rank as rank_mod  # noqa: E402

try:
    import yaml  # type: ignore
    _HAVE_YAML = True
except Exception:  # pragma: no cover
    yaml = None  # type: ignore
    _HAVE_YAML = False


SKILL_MD_PATH = ROOT / "skills" / "find-skills" / "SKILL.md"


def _make_obs(
    *,
    signature: str,
    source_kind: str,
    occurrence_count: int,
    last_seen: str = "2026-05-15T12:00:00Z",
    first_seen: str = "2026-04-15T12:00:00Z",
    recent_examples: list[str] | None = None,
) -> dict:
    """Build a fake observation in the shape se-4's mine() produces."""
    return {
        "pattern_signature": signature,
        "occurrence_count": occurrence_count,
        "recent_examples": recent_examples
        or [f"example-of-{signature}-A", f"example-of-{signature}-B"],
        "source_kind": source_kind,
        "first_seen": first_seen,
        "last_seen": last_seen,
    }


class _TmpDirCase(unittest.TestCase):
    """Mixin: gives every test an isolated tmpdir under ``self.tmp_path``."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp_path = Path(self._tmp.name)


@unittest.skipUnless(_HAVE_YAML, "PyYAML required for yaml round-trip assertions")
class TestAcceptanceOne(_TmpDirCase):
    """AC-1: 10 observations of which 6 meet threshold → 6 ranked
    candidates with ``name`` + ``triggers`` + ``scope_hint`` fields."""

    def test_six_of_ten_meet_threshold_and_are_emitted(self) -> None:
        # 6 above threshold: distinct kg/event/escalation signatures so
        # their suggested names do NOT collide with the existing-skills
        # entry below. occurrence_count >= 3 in every case.
        above_specs = [
            ("kg:decided|epic-alpha-zulu", "kg_triple"),
            ("kg:rejected|sprint-bravo-yankee", "kg_triple"),
            ("event:planner|tokens|implement", "metric_event"),
            ("event:reviewer|wall_clock_ms|review", "metric_event"),
            (
                "escalation:security-scan|pre-exec|major",
                "cycle_escalation",
            ),
            (
                "escalation:perf-regression|post-merge|moderate",
                "cycle_escalation",
            ),
        ]
        above = [
            _make_obs(
                signature=sig,
                source_kind=src,
                occurrence_count=3 + i,
                last_seen="2026-05-18T12:00:00Z",
            )
            for i, (sig, src) in enumerate(above_specs)
        ]
        # 2 below threshold: occurrence_count == 2 (fails count gate).
        below_count = [
            _make_obs(
                signature=f"commit:chore(low-{i})",
                source_kind="commit",
                occurrence_count=2,
                last_seen="2026-05-18T12:00:00Z",
            )
            for i in range(2)
        ]
        # 2 more below threshold: low distinctness — name nearly identical
        # to a fake existing skill so distinctness < 0.5.
        existing_skills = ["commit-feat-existing-very-close-name"]
        below_distinct = [
            _make_obs(
                signature="commit:feat(existing-very-close-name)",
                source_kind="commit",
                occurrence_count=5,
                last_seen="2026-05-18T12:00:00Z",
            ),
            _make_obs(
                signature="commit:feat(existing-very-close-nam)",
                source_kind="commit",
                occurrence_count=5,
                last_seen="2026-05-18T12:00:00Z",
            ),
        ]
        observations = above + below_count + below_distinct
        self.assertEqual(len(observations), 10)

        ranked = rank_mod.rank(
            observations,
            existing_skills=existing_skills,
            now="2026-05-19T00:00:00Z",
        )
        filtered = rank_mod.filter_threshold(ranked)

        self.assertEqual(
            len(filtered), 6,
            f"expected exactly 6 candidates above threshold, "
            f"got {len(filtered)}: {[c['name'] for c in filtered]}",
        )

        # Required fields populated on every surviving candidate.
        for candidate in filtered:
            with self.subTest(name=candidate.get("name")):
                self.assertIn("name", candidate)
                self.assertTrue(candidate["name"], "name must be non-empty")
                self.assertIn("triggers", candidate)
                self.assertIsInstance(candidate["triggers"], list)
                self.assertGreaterEqual(len(candidate["triggers"]), 1)
                self.assertIn("scope_hint", candidate)
                self.assertTrue(
                    candidate["scope_hint"], "scope_hint must be non-empty"
                )

        # Yaml round-trip — write + reload and verify candidates: shape.
        yaml_path = self.tmp_path / ".pHive" / "meta" / "skill-candidates.yaml"
        rank_mod.write_candidates_yaml(
            filtered, yaml_path, now="2026-05-19T00:00:00Z"
        )
        self.assertTrue(yaml_path.exists())
        loaded = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        self.assertIn("candidates", loaded)
        self.assertEqual(len(loaded["candidates"]), 6)
        self.assertIn("generated_at", loaded)
        # Ranking order preserved (sort_keys=False on the writer).
        written_names = [c["name"] for c in loaded["candidates"]]
        ranker_names = [c["name"] for c in filtered]
        self.assertEqual(written_names, ranker_names)


@unittest.skipUnless(_HAVE_YAML, "PyYAML required for yaml round-trip assertions")
class TestAcceptanceTwoEmptyShape(_TmpDirCase):
    """AC-2: empty observations OR all-below-threshold yields the
    one-line note shape with NO ``candidates:`` key and no noise rows."""

    def _assert_empty_yaml_shape(self, yaml_path: Path) -> None:
        self.assertTrue(yaml_path.exists())
        loaded = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
        self.assertIsInstance(loaded, dict)
        # Exactly one top-level key, and it must be `note`.
        self.assertEqual(
            list(loaded.keys()), ["note"],
            f"expected ['note'] only, got {list(loaded.keys())}",
        )
        self.assertEqual(loaded["note"], "no candidates met threshold")
        # No noise rows — `candidates` key must NOT be present.
        self.assertNotIn("candidates", loaded)

    def test_no_observations_produces_one_line_note(self) -> None:
        ranked = rank_mod.rank([], existing_skills=[])
        filtered = rank_mod.filter_threshold(ranked)
        self.assertEqual(filtered, [])

        yaml_path = self.tmp_path / ".pHive" / "meta" / "skill-candidates.yaml"
        rank_mod.write_candidates_yaml(filtered, yaml_path)
        self._assert_empty_yaml_shape(yaml_path)

    def test_all_observations_below_threshold_produces_one_line_note(self) -> None:
        # 5 observations all below threshold (occurrence_count == 2).
        observations = [
            _make_obs(
                signature=f"commit:fix(low-{i})",
                source_kind="commit",
                occurrence_count=2,
            )
            for i in range(5)
        ]
        ranked = rank_mod.rank(
            observations, existing_skills=[], now="2026-05-19T00:00:00Z"
        )
        filtered = rank_mod.filter_threshold(ranked)
        self.assertEqual(
            filtered, [],
            f"expected zero survivors, got {[c['name'] for c in filtered]}",
        )

        yaml_path = self.tmp_path / ".pHive" / "meta" / "skill-candidates.yaml"
        rank_mod.write_candidates_yaml(filtered, yaml_path)
        self._assert_empty_yaml_shape(yaml_path)


class TestAcceptanceThreeHandoffWiring(unittest.TestCase):
    """AC-3: doc-as-contract — SKILL.md must invoke /write-skill via
    the atomic external Skill(...) call. If the hand-off line is removed
    or renamed the prose contract breaks and this test fails."""

    def test_skill_md_invokes_write_skill_via_skill_call(self) -> None:
        text = SKILL_MD_PATH.read_text(encoding="utf-8")
        # Accept either single or double quotes; the Skill( ... write-skill ...)
        # form may span multiple lines, so DOTALL with a bounded greedy span.
        pattern = re.compile(
            r"Skill\([^)]*skill\s*=\s*['\"]write-skill['\"]",
            re.DOTALL,
        )
        matches = pattern.findall(text)
        self.assertGreaterEqual(
            len(matches), 1,
            "SKILL.md must invoke /write-skill via "
            "`Skill(skill=\"write-skill\", ...)` — atomic external call. "
            f"Pattern not found in {SKILL_MD_PATH}.",
        )


class TestAcceptanceFourRecentExamplesReferenced(unittest.TestCase):
    """AC-4: composed brief references the candidate's recent_examples —
    proves the mining → ranking → write-skill chain is wired. Asserted at
    the prose level (the hand-off section mentions recent_examples)."""

    def test_skill_md_handoff_section_references_recent_examples(self) -> None:
        text = SKILL_MD_PATH.read_text(encoding="utf-8")
        self.assertIn(
            "recent_examples", text,
            "SKILL.md must reference `recent_examples` in the hand-off "
            "brief composition so the produced /write-skill scaffold "
            "carries observed evidence forward (AC-4).",
        )


if __name__ == "__main__":
    unittest.main()
