"""Regression test for workflow `step_file` path resolvability.

Background: meta-2026-04-29 nightly flagged 35 (actually 45) `step_file`
entries across 6 workflow YAML files using a relative `workflows/steps/...`
prefix instead of the repo-root-relative `hive/workflows/steps/...`. The
critical-severity finding could not be auto-resolved by that nightly
because of an upstream routing bug. Now that PR #31 fixed the routing,
this test pins every workflow YAML's `step_file` paths to real files on
disk so the prefix bug cannot regress.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import yaml


WORKFLOWS_DIR = Path("hive/workflows")


def _iter_step_files(workflow_yaml: dict) -> list[str]:
    """Return every `step_file` value in a workflow YAML, regardless of nesting."""
    paths: list[str] = []
    for step in workflow_yaml.get("steps", []) or []:
        if not isinstance(step, dict):
            continue
        if "step_file" in step and isinstance(step["step_file"], str):
            paths.append(step["step_file"])
        # Some workflows use nested task lists with step_file entries
        for nested_key in ("tasks", "subtasks", "phase_steps"):
            for sub in step.get(nested_key, []) or []:
                if isinstance(sub, dict) and isinstance(sub.get("step_file"), str):
                    paths.append(sub["step_file"])
    return paths


class WorkflowStepFilePathsResolveTests(unittest.TestCase):
    """Every `step_file` path in every workflow YAML must point at a real file."""

    def test_all_step_file_paths_resolve(self) -> None:
        workflow_files = sorted(WORKFLOWS_DIR.glob("*.workflow.yaml"))
        self.assertGreater(len(workflow_files), 0, "no workflow YAMLs found")

        missing: list[tuple[str, str]] = []
        total_paths = 0

        for wf_path in workflow_files:
            with wf_path.open("r", encoding="utf-8") as fh:
                wf = yaml.safe_load(fh)
            if not isinstance(wf, dict):
                continue
            for step_file in _iter_step_files(wf):
                total_paths += 1
                if not Path(step_file).is_file():
                    missing.append((str(wf_path), step_file))

        self.assertGreater(total_paths, 0, "no step_file entries found in any workflow")
        self.assertFalse(
            missing,
            f"step_file paths do not resolve to real files: {missing}",
        )

    def test_no_step_file_uses_relative_workflows_prefix(self) -> None:
        """The `step_file: workflows/steps/...` shape (without `hive/` prefix) is forbidden.

        That prefix only happens to "work" when the cycle is invoked from the
        plugin-hive repo root and the workflow happens to be read with that cwd.
        It breaks for every consumer of /meta-optimize and is the root cause
        of the meta-2026-04-29 critical MISSING_STEP_FILE finding.
        """
        offenders: list[tuple[str, str]] = []
        for wf_path in WORKFLOWS_DIR.glob("*.workflow.yaml"):
            text = wf_path.read_text(encoding="utf-8")
            for line in text.splitlines():
                stripped = line.strip()
                if stripped.startswith("step_file: workflows/steps/"):
                    offenders.append((str(wf_path), stripped))

        self.assertFalse(
            offenders,
            "workflow YAMLs use relative `workflows/steps/` prefix instead of `hive/workflows/steps/`: "
            f"{offenders}",
        )


if __name__ == "__main__":
    unittest.main()
