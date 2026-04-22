from __future__ import annotations

import importlib.util
import sys
import unittest
from dataclasses import FrozenInstanceError
from pathlib import Path


def _load_meta_experiment_module():
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


class PromotionAdapterContractTests(unittest.TestCase):
    def setUp(self) -> None:
        meta_experiment = _load_meta_experiment_module()
        self.PromotionAdapter = meta_experiment.PromotionAdapter
        self.PromotionEvidence = meta_experiment.PromotionEvidence
        self.PromotionResult = meta_experiment.PromotionResult
        self.RollbackResult = meta_experiment.RollbackResult

        class FakePromotionAdapter(self.PromotionAdapter):
            def promote(self, envelope: dict, decision: dict):
                variant = decision["variant"]
                if variant == "commit":
                    evidence = self._evidence_cls(commit_ref=decision["ref"])
                else:
                    evidence = self._evidence_cls(pr_ref=decision["ref"])
                return self._promotion_result_cls(
                    success=decision["success"],
                    evidence=evidence,
                    rollback_target=decision["rollback_target"],
                    notes=decision.get("notes"),
                )

            def rollback(self, envelope: dict, rollback_ref: str):
                if rollback_ref.startswith("rollback:"):
                    return self._rollback_result_cls(
                        success=True,
                        revert_ref=f"revert:{rollback_ref}",
                        notes="rollback applied",
                    )
                return self._rollback_result_cls(
                    success=False,
                    revert_ref=None,
                    notes="rollback unavailable",
                )

        FakePromotionAdapter._evidence_cls = self.PromotionEvidence
        FakePromotionAdapter._promotion_result_cls = self.PromotionResult
        FakePromotionAdapter._rollback_result_cls = self.RollbackResult
        self.FakePromotionAdapter = FakePromotionAdapter

    def test_abstract_adapter_cannot_be_instantiated_directly(self) -> None:
        with self.assertRaises(TypeError):
            self.PromotionAdapter()

    def test_promotion_evidence_accepts_commit_reference(self) -> None:
        evidence = self.PromotionEvidence(commit_ref="git:abc123")

        self.assertEqual("git:abc123", evidence.commit_ref)
        self.assertIsNone(evidence.pr_ref)

    def test_promotion_evidence_accepts_pr_reference(self) -> None:
        evidence = self.PromotionEvidence(pr_ref="pr:42")

        self.assertIsNone(evidence.commit_ref)
        self.assertEqual("pr:42", evidence.pr_ref)

    def test_promotion_evidence_rejects_both_references_missing(self) -> None:
        with self.assertRaises(ValueError):
            self.PromotionEvidence()

    def test_promotion_evidence_rejects_both_references_set(self) -> None:
        with self.assertRaises(ValueError):
            self.PromotionEvidence(commit_ref="git:abc123", pr_ref="pr:42")

    def test_fake_adapter_round_trip_commit_variant(self) -> None:
        adapter = self.FakePromotionAdapter()

        result = adapter.promote(
            envelope={"experiment_id": "exp_commit"},
            decision={
                "variant": "commit",
                "ref": "git:abc123",
                "success": True,
                "rollback_target": "rollback:git:abc123",
                "notes": "maintainer path",
            },
        )

        self.assertTrue(result.success)
        self.assertEqual("git:abc123", result.evidence.commit_ref)
        self.assertIsNone(result.evidence.pr_ref)
        self.assertEqual("rollback:git:abc123", result.rollback_target)
        self.assertEqual("maintainer path", result.notes)

    def test_fake_adapter_round_trip_pr_variant(self) -> None:
        adapter = self.FakePromotionAdapter()

        result = adapter.promote(
            envelope={"experiment_id": "exp_pr"},
            decision={
                "variant": "pr",
                "ref": "pr:42",
                "success": True,
                "rollback_target": "rollback:pr:42",
                "notes": "public path",
            },
        )

        self.assertTrue(result.success)
        self.assertIsNone(result.evidence.commit_ref)
        self.assertEqual("pr:42", result.evidence.pr_ref)
        self.assertEqual("rollback:pr:42", result.rollback_target)
        self.assertEqual("public path", result.notes)

    def test_rollback_result_supports_success_and_failure_cases(self) -> None:
        adapter = self.FakePromotionAdapter()

        success = adapter.rollback({"experiment_id": "exp_success"}, "rollback:git:abc123")
        failure = adapter.rollback({"experiment_id": "exp_failure"}, "git:abc123")

        self.assertEqual(
            self.RollbackResult(
                success=True,
                revert_ref="revert:rollback:git:abc123",
                notes="rollback applied",
            ),
            success,
        )
        self.assertEqual(
            self.RollbackResult(
                success=False,
                revert_ref=None,
                notes="rollback unavailable",
            ),
            failure,
        )

    def test_dataclasses_are_frozen(self) -> None:
        evidence = self.PromotionEvidence(commit_ref="git:abc123")
        result = self.PromotionResult(
            success=True,
            evidence=evidence,
            rollback_target="rollback:git:abc123",
        )

        with self.assertRaises(FrozenInstanceError):
            evidence.commit_ref = "git:def456"  # type: ignore[misc]

        with self.assertRaises(FrozenInstanceError):
            result.notes = "updated"  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
