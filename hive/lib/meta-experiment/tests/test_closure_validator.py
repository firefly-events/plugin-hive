"""Tests for close-validation predicates and error contracts."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


def _load_meta_experiment_module():
    """Load the meta-experiment package from the dashed directory name."""
    module_dir = Path("hive/lib/meta-experiment")
    init_path = module_dir / "__init__.py"
    spec = importlib.util.spec_from_file_location(
        "hive.lib.meta_experiment",
        init_path,
        submodule_search_locations=[str(module_dir)],
    )
    if spec is None or spec.loader is None:
        raise AssertionError("failed to build import spec for meta-experiment package")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class ClosureValidatorTests(unittest.TestCase):
    """Verify closure validation rules and exported errors."""

    def setUp(self) -> None:
        meta_experiment = _load_meta_experiment_module()
        self.closure_validator = meta_experiment.closure_validator
        self.validate_closable = meta_experiment.validate_closable
        self.is_closable = meta_experiment.is_closable
        self.CloseValidationError = meta_experiment.CloseValidationError
        self.MissingEvidenceError = meta_experiment.MissingEvidenceError
        self.AmbiguousEvidenceError = meta_experiment.AmbiguousEvidenceError
        self.MissingMetricsSnapshotError = meta_experiment.MissingMetricsSnapshotError
        self.MissingRollbackTargetError = meta_experiment.MissingRollbackTargetError
        self.InvalidDecisionError = meta_experiment.InvalidDecisionError

    def test_missing_commit_ref_and_pr_ref_raises_missing_evidence(self) -> None:
        envelope = self._close_envelope()
        del envelope["commit_ref"]

        with self.assertRaises(self.MissingEvidenceError):
            self.validate_closable(envelope)

    def test_missing_metrics_snapshot_raises_missing_metrics_snapshot(self) -> None:
        envelope = self._close_envelope()
        del envelope["metrics_snapshot"]

        with self.assertRaises(self.MissingMetricsSnapshotError):
            self.validate_closable(envelope)

    def test_missing_rollback_ref_raises_missing_rollback_target(self) -> None:
        envelope = self._close_envelope()
        del envelope["rollback_ref"]

        with self.assertRaises(self.MissingRollbackTargetError):
            self.validate_closable(envelope)

    def test_both_commit_ref_and_pr_ref_raises_ambiguous_evidence(self) -> None:
        envelope = self._close_envelope(pr_ref="pr:42")

        with self.assertRaises(self.AmbiguousEvidenceError):
            self.validate_closable(envelope)

    def test_missing_decision_raises_invalid_decision(self) -> None:
        envelope = self._close_envelope()
        del envelope["decision"]

        with self.assertRaisesRegex(self.InvalidDecisionError, "decision is missing"):
            self.validate_closable(envelope)

    def test_pending_decision_raises_invalid_decision_with_not_closable_message(self) -> None:
        envelope = self._close_envelope(decision="pending")

        with self.assertRaisesRegex(self.InvalidDecisionError, "not closable"):
            self.validate_closable(envelope)

    def test_unknown_decision_raises_invalid_decision(self) -> None:
        envelope = self._close_envelope(decision="defer")

        with self.assertRaisesRegex(self.InvalidDecisionError, "unrecognized decision value"):
            self.validate_closable(envelope)

    def test_direct_commit_accept_record_is_closable(self) -> None:
        envelope = self._close_envelope(decision="accept")

        self.assertIsNone(self.validate_closable(envelope))
        self.assertTrue(self.is_closable(envelope))

    def test_direct_commit_reverted_record_is_closable(self) -> None:
        envelope = self._close_envelope(decision="reverted")

        self.assertIsNone(self.validate_closable(envelope))
        self.assertTrue(self.is_closable(envelope))

    def test_pr_only_accept_record_is_closable(self) -> None:
        envelope = self._close_envelope(commit_ref=None, pr_ref="pr:42")

        self.assertIsNone(self.validate_closable(envelope))
        self.assertTrue(self.is_closable(envelope))

    def test_direct_commit_reject_record_is_closable(self) -> None:
        envelope = self._close_envelope(decision="reject")

        self.assertIsNone(self.validate_closable(envelope))
        self.assertTrue(self.is_closable(envelope))

    def test_non_dict_envelope_raises_type_error(self) -> None:
        for envelope in ([], "not an envelope", None):
            with self.subTest(envelope=envelope):
                with self.assertRaises(TypeError):
                    self.validate_closable(envelope)

    def test_error_class_hierarchy(self) -> None:
        self.assertTrue(issubclass(self.CloseValidationError, Exception))
        self.assertTrue(issubclass(self.MissingEvidenceError, self.CloseValidationError))
        self.assertTrue(issubclass(self.AmbiguousEvidenceError, self.CloseValidationError))
        self.assertTrue(issubclass(self.MissingMetricsSnapshotError, self.CloseValidationError))
        self.assertTrue(issubclass(self.MissingRollbackTargetError, self.CloseValidationError))
        self.assertTrue(issubclass(self.InvalidDecisionError, self.CloseValidationError))

    def test_is_closable_swallows_exceptions_and_returns_false(self) -> None:
        self.assertFalse(self.is_closable({"decision": "pending"}))
        self.assertFalse(self.is_closable(None))

    def test_empty_metrics_snapshot_raises_missing_metrics_snapshot(self) -> None:
        envelope = self._close_envelope(metrics_snapshot={})

        with self.assertRaises(self.MissingMetricsSnapshotError):
            self.validate_closable(envelope)

    def test_public_surface_exports_validator_contract(self) -> None:
        public_names = {
            name
            for name in vars(self.closure_validator)
            if not name.startswith("_") and name != "annotations"
        }

        self.assertEqual(
            {
                "CloseValidationError",
                "MissingEvidenceError",
                "AmbiguousEvidenceError",
                "MissingMetricsSnapshotError",
                "MissingRollbackTargetError",
                "InvalidDecisionError",
                "validate_closable",
                "is_closable",
            },
            public_names,
        )

    def _close_envelope(
        self,
        *,
        decision: str = "accept",
        commit_ref: str | None = "git:abc123",
        pr_ref: str | None = None,
        metrics_snapshot: dict | None = None,
        rollback_ref: str | None = "rollback:git:abc123",
    ) -> dict:
        envelope = {
            "experiment_id": "exp_close_001",
            "decision": decision,
            "metrics_snapshot": {"tokens": 100} if metrics_snapshot is None else metrics_snapshot,
            "rollback_ref": rollback_ref,
        }
        if commit_ref is not None:
            envelope["commit_ref"] = commit_ref
        if pr_ref is not None:
            envelope["pr_ref"] = pr_ref
        return envelope


if __name__ == "__main__":
    unittest.main()
