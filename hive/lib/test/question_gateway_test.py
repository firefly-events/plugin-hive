from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hive.lib.question_gateway import (
    HeadlessConfig,
    QuestionDeadlineExpiredError,
    ask_or_emit,
    envelope_path,
    find_envelope_for_phase,
    renew_envelope,
    write_envelope,
)

QUESTIONS = [
    {"qid": "metrics-opt-in", "text": "Enable metrics tracking?", "kind": "single-select", "options": ["yes", "no"], "required": True},
]


class QuestionGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base_dir = Path(self.tmp.name) / "questions"
        self.default_cfg = HeadlessConfig(answer_deadline_seconds=1800, deadline_expired_action="re-emit")
        self.fail_cfg = HeadlessConfig(answer_deadline_seconds=1800, deadline_expired_action="fail")

    def test_writes_one_envelope_batching_all_questions_for_the_phase(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        result = ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now, config=self.default_cfg)
        self.assertFalse(result["resolved"])
        self.assertEqual(result["status"], "pending")
        found = find_envelope_for_phase("kickoff", "1a", base_dir=self.base_dir)
        self.assertIsNotNone(found)
        env, _ = found
        self.assertEqual(env["status"], "pending")
        self.assertEqual(len(env["questions"]), 1)
        self.assertEqual(env["questions"][0]["qid"], "metrics-opt-in")

    def test_resume_consumes_answered_envelope_without_reprompt(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now, config=self.default_cfg)
        env, path = find_envelope_for_phase("kickoff", "1a", base_dir=self.base_dir)

        # Simulate external orchestrator answer-write.
        env["questions"][0]["answer"] = "yes"
        env["status"] = "answered"
        import yaml

        path.write_text(yaml.safe_dump(env, sort_keys=False), encoding="utf-8")

        result = ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now, config=self.default_cfg)
        self.assertTrue(result["resolved"])
        self.assertEqual(result["answers"], {"metrics-opt-in": "yes"})

        # No new envelope was created by the resume call.
        candidates = sorted(self.base_dir.glob("kickoff-*.yaml"))
        self.assertEqual(len(candidates), 1)

    def test_still_pending_and_not_expired_reexits_without_mutating_envelope(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now, config=self.default_cfg)
        _, path_before = find_envelope_for_phase("kickoff", "1a", base_dir=self.base_dir)
        mtime_before = path_before.stat().st_mtime

        later = now + timedelta(seconds=60)
        result = ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=later, config=self.default_cfg)
        self.assertFalse(result["resolved"])
        self.assertEqual(result["status"], "pending")

        candidates = sorted(self.base_dir.glob("kickoff-*.yaml"))
        self.assertEqual(len(candidates), 1, "re-exit on a still-valid pending envelope must not write a new one")
        self.assertEqual(candidates[0].stat().st_mtime, mtime_before)

    def test_expired_with_no_renewal_reemits_by_default(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        _, first_deadline = write_envelope(
            "kickoff", "1a", QUESTIONS, base_dir=self.base_dir, deadline_seconds=60, now=now
        )
        past_deadline = now + timedelta(seconds=61)
        result = ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=past_deadline, config=self.default_cfg)
        self.assertFalse(result["resolved"])
        candidates = sorted(self.base_dir.glob("kickoff-*.yaml"))
        self.assertEqual(len(candidates), 2, "expiry with re-emit action writes a fresh envelope")

    def test_expired_with_no_renewal_fails_when_configured(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        write_envelope("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, deadline_seconds=60, now=now)
        past_deadline = now + timedelta(seconds=61)
        with self.assertRaises(QuestionDeadlineExpiredError):
            ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=past_deadline, config=self.fail_cfg)

    def test_renewal_before_expiry_keeps_envelope_valid_past_original_deadline(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        env, path = write_envelope("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, deadline_seconds=60, now=now)
        self.assertEqual(env["renewal_count"], 0)

        renew_time = now + timedelta(seconds=30)
        renewed = renew_envelope(path, extra_seconds=3600, now=renew_time)
        self.assertEqual(renewed["renewal_count"], 1)

        past_original_deadline = now + timedelta(seconds=61)
        result = ask_or_emit(
            "kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=past_original_deadline, config=self.fail_cfg
        )
        # Would have raised QuestionDeadlineExpiredError under fail_cfg if the
        # renewal hadn't extended the deadline past the original one.
        self.assertFalse(result["resolved"])
        self.assertEqual(result["status"], "pending")

    def test_envelope_ids_do_not_collide_within_the_same_wall_clock_second(self) -> None:
        # Regression for CodeRabbit review (PR #341): whole-second invocation
        # ids meant two writes in the same second for the same skill (but
        # different phases) silently overwrote each other on disk.
        now = datetime(2026, 7, 25, 22, 10, 0, 100000, tzinfo=timezone.utc)
        later_same_second = datetime(2026, 7, 25, 22, 10, 0, 900000, tzinfo=timezone.utc)
        _, path_a = write_envelope("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now)
        _, path_b = write_envelope("kickoff", "1b", QUESTIONS, base_dir=self.base_dir, now=later_same_second)
        self.assertNotEqual(path_a, path_b)
        candidates = sorted(self.base_dir.glob("kickoff-*.yaml"))
        self.assertEqual(len(candidates), 2)

    def test_skill_component_is_sanitized_in_the_envelope_path(self) -> None:
        # Regression for CodeRabbit review (PR #341): only invocation_id was
        # slugged, not skill.
        path = envelope_path("weird/skill name", "2026-07-25T22-10-00-000Z", base_dir=self.base_dir)
        self.assertNotIn("/", path.name)
        self.assertEqual(path.parent, self.base_dir)

    def test_malformed_envelope_raises_instead_of_being_treated_as_missing(self) -> None:
        # Regression for CodeRabbit review (PR #341): a non-dict-shaped (or
        # unparseable) envelope must surface an error, not be silently
        # treated as "no envelope" — that conflation would let a caller
        # write a duplicate envelope over corrupted state.
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        _, path = write_envelope("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now)
        path.write_text("- just\n- a\n- list\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            find_envelope_for_phase("kickoff", "1a", base_dir=self.base_dir)

    def test_answered_status_with_missing_required_answer_is_treated_as_pending(self) -> None:
        now = datetime(2026, 7, 25, 22, 10, 0, tzinfo=timezone.utc)
        ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now, config=self.default_cfg)
        env, path = find_envelope_for_phase("kickoff", "1a", base_dir=self.base_dir)

        # Malformed: status flipped to answered but required answer left null.
        env["status"] = "answered"
        import yaml

        path.write_text(yaml.safe_dump(env, sort_keys=False), encoding="utf-8")

        result = ask_or_emit("kickoff", "1a", QUESTIONS, base_dir=self.base_dir, now=now, config=self.default_cfg)
        self.assertFalse(result["resolved"], "closure invariant requires every required answer to be non-null")


if __name__ == "__main__":
    unittest.main()
