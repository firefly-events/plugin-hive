"""Tests for hive/lib/skill_candidate_mine.py — covers the 4 AC cases
from story ``se-4-signal-mining``.

The story's worker-contract YAML names the file
``tests/skill-candidate-mining.test.js``, but the underlying helper is
Python and the test runner is ``python -m unittest discover tests``
(same pattern as ed-3's ``tests/test_scope_drift.py`` and ed-4's
``tests/test_scope_drift_reader.py``). The story description is the
binding source — established/greenfield/malformed/determinism — so
the test lives in Python under ``tests/`` to match the helper.

Each AC has at least one dedicated test method:
- AC-1 (established + 50 events + 30 commits  -> >= 5 observations)
- AC-2 (greenfield maturity                   -> skip + [])
- AC-3 (malformed jsonl row                   -> skipped + no crash)
- AC-4 (repeat run                            -> identical results)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hive.lib import skill_candidate_mine as mod  # noqa: E402


def _have_git() -> bool:
    return shutil.which("git") is not None


class _ProjectFixture(unittest.TestCase):
    """Build an isolated ``.pHive``-shaped project tree in a tmpdir."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

        self.project_root = Path(self._tmp.name)
        self.state_dir = self.project_root / ".pHive"
        self.events_dir = self.state_dir / "metrics" / "events"
        self.cycle_dir = self.state_dir / "cycle-state"
        self.events_dir.mkdir(parents=True)
        self.cycle_dir.mkdir(parents=True)

        # Default profile = established (gate open). Tests override.
        self._write_profile("established")

    def _write_profile(self, maturity: str) -> None:
        # Skip the YAML library and write a plain key — the soft-stub
        # for resolve_maturity() falls back to ``established`` if the
        # ed-1 helper is absent. Tests below also monkeypatch
        # ``mod._resolve_maturity`` directly to force the gate.
        profile = self.state_dir / "project-profile.yaml"
        profile.write_text(f"project_maturity: {maturity}\n", encoding="utf-8")

    def _write_event_row(self, *, day: str, idx: int, agent: str,
                        metric_type: str, phase: str) -> None:
        run_id = f"run-{day}"
        path = self.events_dir / f"{day}.jsonl"
        row = {
            "agent": agent,
            "event_id": f"{run_id}-evt-{idx}",
            "metric_type": metric_type,
            "phase": phase,
            "run_id": run_id,
            "timestamp": f"2026-05-{day}T{idx:02d}:00:00Z",
            "value": idx,
        }
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row) + "\n")

    def _seed_events(self, *, count: int, distinct_signatures: int = 5) -> None:
        """Seed `count` events spread evenly across `distinct_signatures`
        ``(agent, metric_type, phase)`` triples. Each triple is hit at
        least twice so it passes the ``MIN_OCCURRENCES`` filter."""
        signatures = [
            ("orchestrator", "tokens", "implementation"),
            ("orchestrator", "wall_clock_ms", "implementation"),
            ("developer", "tokens", "implement"),
            ("reviewer", "tokens", "review"),
            ("tester", "first_attempt_pass", "test"),
            ("researcher", "tokens", "research"),
            ("orchestrator", "tokens", "integrate"),
        ]
        assert distinct_signatures <= len(signatures), (
            "fixture only carries 7 distinct triples"
        )
        sigs = signatures[:distinct_signatures]
        for i in range(count):
            sig = sigs[i % len(sigs)]
            day = f"{10 + (i // 10):02d}"
            self._write_event_row(
                day=day,
                idx=i,
                agent=sig[0],
                metric_type=sig[1],
                phase=sig[2],
            )

    def _write_cycle_state(self, name: str, escalations: list[dict]) -> None:
        # Hand-emit minimal YAML so the fixture doesn't depend on
        # PyYAML being available in the writer path.
        path = self.cycle_dir / f"{name}.yaml"
        lines = [f"epic: {name}", "created_at: \"2026-04-01T00:00:00Z\"", "escalations:"]
        for esc in escalations:
            lines.append(f"  - trigger: {esc['trigger']}")
            lines.append(f"    placement: {esc['placement']}")
            lines.append(f"    severity: {esc['severity']}")
            lines.append(f"    raised_at: \"{esc['raised_at']}\"")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _init_git_repo(self, *, commits: int) -> None:
        """Initialize a real git repo in ``project_root`` with
        ``commits`` conventional-commit-style commits across a few
        scopes so we hit ``>= 2`` per pattern."""
        env = os.environ.copy()
        env.update({
            "GIT_AUTHOR_NAME": "fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.com",
            "GIT_COMMITTER_NAME": "fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.com",
        })
        run = lambda *args: subprocess.run(  # noqa: E731
            args, cwd=self.project_root, env=env, check=True,
            capture_output=True, text=True,
        )
        run("git", "init", "-q", "-b", "main")
        run("git", "config", "user.email", "fixture@example.com")
        run("git", "config", "user.name", "fixture")
        # Conventional commit messages — repeat scopes so patterns recur.
        scopes = [
            ("feat", "execute"),
            ("feat", "plan"),
            ("fix", "sandcastle"),
            ("docs", "schema"),
            ("chore", "deps"),
        ]
        marker = self.project_root / "file.txt"
        for i in range(commits):
            ctype, scope = scopes[i % len(scopes)]
            marker.write_text(f"{i}", encoding="utf-8")
            run("git", "add", "file.txt")
            run("git", "commit", "-q", "-m", f"{ctype}({scope}): step {i}")

    def _force_gate(self, maturity: str) -> None:
        """Force the maturity gate regardless of what the soft stub
        for resolve_maturity returns."""
        original = mod._resolve_maturity
        mod._resolve_maturity = lambda _path=None: maturity
        self.addCleanup(lambda: setattr(mod, "_resolve_maturity", original))


@unittest.skipUnless(_have_git(), "git binary required for commit-source AC")
class TestEstablishedMining(_ProjectFixture):
    """AC-1: >= 5 observations from an established project."""

    def test_returns_at_least_five_observations(self) -> None:
        self._force_gate("established")
        self._seed_events(count=50, distinct_signatures=5)
        self._write_cycle_state(
            "epic-A",
            escalations=[
                {"trigger": "security:plan-audit", "placement": "pre-exec",
                 "severity": "minor", "raised_at": "2026-04-10T00:00:00Z"},
                {"trigger": "performance:audit", "placement": "pre-exec",
                 "severity": "moderate", "raised_at": "2026-04-11T00:00:00Z"},
            ],
        )
        self._write_cycle_state(
            "epic-B",
            escalations=[
                {"trigger": "security:plan-audit", "placement": "pre-exec",
                 "severity": "minor", "raised_at": "2026-04-12T00:00:00Z"},
                {"trigger": "performance:audit", "placement": "pre-exec",
                 "severity": "moderate", "raised_at": "2026-04-13T00:00:00Z"},
            ],
        )
        self._init_git_repo(commits=30)

        observations = mod.mine(
            state_dir=self.state_dir, project_root=self.project_root
        )

        self.assertGreaterEqual(
            len(observations), 5,
            f"expected >= 5 observations, got {len(observations)}: "
            f"{[o['pattern_signature'] for o in observations]}",
        )
        # Every observation must have non-empty required fields.
        for obs in observations:
            with self.subTest(sig=obs["pattern_signature"]):
                self.assertTrue(obs["pattern_signature"])
                self.assertGreaterEqual(obs["occurrence_count"], 2)
                self.assertIn(obs["source_kind"], {
                    mod.SOURCE_METRIC_EVENT,
                    mod.SOURCE_KG_TRIPLE,
                    mod.SOURCE_COMMIT,
                    mod.SOURCE_CYCLE_ESCALATION,
                })
                self.assertIsInstance(obs["recent_examples"], list)
                self.assertGreaterEqual(len(obs["recent_examples"]), 1)
                self.assertLessEqual(len(obs["recent_examples"]), 3)


class TestGreenfieldGate(_ProjectFixture):
    """AC-2: greenfield maturity short-circuits to []."""

    def test_returns_empty_with_skip_log(self) -> None:
        self._force_gate("greenfield")
        # Seed lots of data — the gate should still skip.
        self._seed_events(count=50)

        with self.assertLogs(mod._log, level="INFO") as captured:
            observations = mod.mine(
                state_dir=self.state_dir, project_root=self.project_root
            )

        self.assertEqual(observations, [])
        self.assertTrue(
            any("skip: greenfield" in line for line in captured.output),
            f"expected 'skip: greenfield' log line, got: {captured.output}",
        )

    def test_early_maturity_also_skipped(self) -> None:
        self._force_gate("early")
        self._seed_events(count=20)
        with self.assertLogs(mod._log, level="INFO") as captured:
            observations = mod.mine(
                state_dir=self.state_dir, project_root=self.project_root
            )
        self.assertEqual(observations, [])
        self.assertTrue(
            any("skip: early" in line for line in captured.output),
            f"expected 'skip: early' log line, got: {captured.output}",
        )


class TestMalformedEventRow(_ProjectFixture):
    """AC-3: malformed jsonl rows are skipped with a warning, no crash."""

    def test_malformed_row_skipped(self) -> None:
        self._force_gate("established")
        # 4 valid + 1 garbled + 1 non-dict row → patterns from the 4 valid
        path = self.events_dir / "10.jsonl"
        rows = [
            json.dumps({"agent": "orchestrator", "metric_type": "tokens",
                        "phase": "impl", "timestamp": "2026-05-10T00:00:00Z",
                        "event_id": "e1"}),
            "{not-json{",                                    # malformed
            json.dumps({"agent": "orchestrator", "metric_type": "tokens",
                        "phase": "impl", "timestamp": "2026-05-10T01:00:00Z",
                        "event_id": "e2"}),
            json.dumps("a-string-not-an-object"),            # non-dict
            json.dumps({"agent": "orchestrator", "metric_type": "tokens",
                        "phase": "impl", "timestamp": "2026-05-10T02:00:00Z",
                        "event_id": "e3"}),
            json.dumps({"agent": "orchestrator", "metric_type": "tokens",
                        "phase": "impl", "timestamp": "2026-05-10T03:00:00Z",
                        "event_id": "e4"}),
        ]
        path.write_text("\n".join(rows) + "\n", encoding="utf-8")

        with self.assertLogs(mod._log, level="WARNING") as captured:
            observations = mod.mine(
                state_dir=self.state_dir, project_root=self.project_root
            )

        warnings = [line for line in captured.output if "WARNING" in line]
        self.assertTrue(
            any("malformed jsonl" in line for line in warnings),
            f"expected malformed-row warning, got: {warnings}",
        )
        self.assertTrue(
            any("non-object jsonl" in line for line in warnings),
            f"expected non-object-row warning, got: {warnings}",
        )

        event_obs = [
            o for o in observations
            if o["source_kind"] == mod.SOURCE_METRIC_EVENT
        ]
        self.assertEqual(len(event_obs), 1)
        self.assertEqual(event_obs[0]["occurrence_count"], 4)


@unittest.skipUnless(_have_git(), "git binary required for commit-source AC")
class TestDeterminism(_ProjectFixture):
    """AC-4: repeat runs against the same state produce identical output."""

    def test_two_runs_byte_identical(self) -> None:
        self._force_gate("established")
        self._seed_events(count=40, distinct_signatures=4)
        self._write_cycle_state(
            "epic-A",
            escalations=[
                {"trigger": "security:plan-audit", "placement": "pre-exec",
                 "severity": "minor", "raised_at": "2026-04-10T00:00:00Z"},
                {"trigger": "security:plan-audit", "placement": "pre-exec",
                 "severity": "minor", "raised_at": "2026-04-11T00:00:00Z"},
            ],
        )
        self._init_git_repo(commits=10)

        run_a = mod.mine(
            state_dir=self.state_dir, project_root=self.project_root
        )
        run_b = mod.mine(
            state_dir=self.state_dir, project_root=self.project_root
        )

        self.assertEqual(run_a, run_b)
        # Pattern signatures should never contain timestamps — that
        # would break determinism across calendar-time drift.
        for obs in run_a:
            self.assertNotRegex(
                obs["pattern_signature"],
                r"\d{4}-\d{2}-\d{2}",
                msg=f"signature leaks timestamp: {obs['pattern_signature']}",
            )


class TestKgSilentOnAbsence(_ProjectFixture):
    """Side test: kg.sqlite missing is a silent skip, not a crash."""

    def test_missing_kg_does_not_crash(self) -> None:
        self._force_gate("established")
        # No kg.sqlite written — mine() should still work.
        self._seed_events(count=20)
        observations = mod.mine(
            state_dir=self.state_dir, project_root=self.project_root
        )
        # Non-empty (events provide observations) and no KG entries.
        self.assertTrue(observations)
        self.assertFalse(
            any(o["source_kind"] == mod.SOURCE_KG_TRIPLE for o in observations)
        )


class TestKgReader(_ProjectFixture):
    """Side test: when a kg.sqlite IS present, triples turn into patterns."""

    def test_kg_triples_are_mined(self) -> None:
        self._force_gate("established")
        db_path = self.state_dir / "kg.sqlite"
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute(
                """
                CREATE TABLE triples (
                  subject TEXT, predicate TEXT, object TEXT,
                  valid_from TEXT, source_epic TEXT, source_agent TEXT
                )
                """
            )
            # Two triples with the same predicate+namespace → recurs.
            for i in range(3):
                conn.execute(
                    "INSERT INTO triples VALUES (?, ?, ?, ?, ?, ?)",
                    (f"epic:e{i}", "decided", "ship", f"2026-04-{i+1:02d}T00:00:00Z",
                     "e", "orch"),
                )
            conn.commit()

        observations = mod.mine(
            state_dir=self.state_dir, project_root=self.project_root
        )
        kg_obs = [
            o for o in observations
            if o["source_kind"] == mod.SOURCE_KG_TRIPLE
        ]
        self.assertEqual(len(kg_obs), 1)
        self.assertEqual(kg_obs[0]["occurrence_count"], 3)
        self.assertEqual(kg_obs[0]["pattern_signature"], "kg:decided|epic")


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    unittest.main()
