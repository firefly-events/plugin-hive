"""Unit tests for snapshot diff helpers."""

from __future__ import annotations

import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from hive.lib.harness import snapshot
from hive.lib.metrics.errors import MetricsValidationError


def _fixture_snapshot(
    label: str,
    files: list[str],
    by_top_dir: dict[str, int],
    by_ext: dict[str, int],
) -> dict[str, object]:
    return {
        "label": label,
        "captured_at": "2026-07-04T00:00:00+00:00",
        "repo": "/tmp/repo",
        "git": {"sha": "deadbeef", "branch": "feat/metric-capture-harness", "dirty": False},
        "files": {
            "total": len(files),
            "by_top_dir": by_top_dir,
            "by_ext": by_ext,
            "list": files,
        },
        "tree": {"files": 0, "total": len(files), "dirs": {}},
    }


class SnapshotDiffTest(unittest.TestCase):
    def test_diff_snapshots_reports_files_added_removed_and_count_deltas(self) -> None:
        before = _fixture_snapshot(
            "kickoff-before",
            [
                "README.md",
                "src/app.py",
                "docs/spec.md",
                "tests/test_existing.py",
            ],
            {"tests": 1, "(root)": 1, "src": 1, "docs": 1},
            {".py": 2, ".md": 2},
        )
        after = _fixture_snapshot(
            "kickoff-after",
            [
                "README.md",
                "src/app.py",
                "src/new_feature.py",
                "tests/test_existing.py",
                "tests/test_snapshot.py",
            ],
            {"src": 2, "tests": 2, "(root)": 1},
            {".py": 4, ".md": 1},
        )

        diff = snapshot.diff_snapshots(before, after)

        self.assertEqual(diff["before_label"], "kickoff-before")
        self.assertEqual(diff["after_label"], "kickoff-after")
        self.assertEqual(diff["files_added"], ["src/new_feature.py", "tests/test_snapshot.py"])
        self.assertEqual(diff["files_removed"], ["docs/spec.md"])
        self.assertEqual(
            diff["by_top_dir_delta"],
            {"(root)": 0, "docs": -1, "src": 1, "tests": 1},
        )
        self.assertEqual(diff["by_ext_delta"], {".md": -1, ".py": 2})


class SnapshotFileLoadingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory(prefix="snapshot-tests-")
        self.addCleanup(self.tmpdir.cleanup)
        self.repo = Path(self.tmpdir.name) / "repo"
        self.repo.mkdir()
        self.state_dir = Path(self.tmpdir.name) / "state"
        self.state_dir.mkdir()
        self.env = patch.dict(os.environ, {"HIVE_STATE_DIR": str(self.state_dir)}, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)

    def _write_snapshot(self, label: str, payload: dict[str, object]) -> Path:
        out_path = snapshot.snapshot_dir(self.repo) / f"{label}.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload), encoding="utf-8")
        return out_path

    def test_load_snapshot_missing_file_raises_clear_error(self) -> None:
        missing = "kickoff-before"

        with self.assertRaises(FileNotFoundError) as ctx:
            snapshot.load_snapshot(missing, self.repo)

        message = str(ctx.exception)
        self.assertIn("snapshot 'kickoff-before' not found", message)
        self.assertIn("kickoff-before.json", message)

    def test_write_snapshot_persists_after_snapshot_alongside_existing_before(self) -> None:
        before = _fixture_snapshot(
            "kickoff-before",
            ["README.md"],
            {"(root)": 1},
            {".md": 1},
        )
        after = _fixture_snapshot(
            "kickoff-after",
            ["README.md", "src/app.py"],
            {"(root)": 1, "src": 1},
            {".md": 1, ".py": 1},
        )
        before_path = self._write_snapshot("kickoff-before", before)

        with patch.object(snapshot, "build_snapshot", return_value=after):
            out_path = snapshot.write_snapshot("kickoff-after", self.repo)

        self.assertEqual(out_path, snapshot.snapshot_dir(self.repo) / "kickoff-after.json")
        self.assertTrue(before_path.exists())
        self.assertEqual(
            json.loads(out_path.read_text(encoding="utf-8"))["label"],
            "kickoff-after",
        )

    def test_diff_snapshot_files_uses_existing_baseline_without_recapture(self) -> None:
        before = _fixture_snapshot(
            "kickoff-before",
            ["README.md", "src/app.py"],
            {"(root)": 1, "src": 1},
            {".md": 1, ".py": 1},
        )
        after = _fixture_snapshot(
            "kickoff-after",
            ["README.md", "src/app.py", "src/new_feature.py", "tests/test_snapshot.py"],
            {"(root)": 1, "src": 2, "tests": 1},
            {".md": 1, ".py": 3},
        )
        self._write_snapshot("kickoff-before", before)
        self._write_snapshot("kickoff-after", after)

        diff = snapshot.diff_snapshot_files("kickoff-before", "kickoff-after", self.repo)

        self.assertEqual(diff["files_added"], ["src/new_feature.py", "tests/test_snapshot.py"])
        self.assertEqual(diff["files_removed"], [])
        self.assertEqual(diff["by_top_dir_delta"], {"(root)": 0, "src": 1, "tests": 1})
        self.assertEqual(diff["by_ext_delta"], {".md": 0, ".py": 2})

    def test_diff_snapshot_files_names_missing_before_or_after_label(self) -> None:
        after = _fixture_snapshot(
            "kickoff-after",
            ["README.md"],
            {"(root)": 1},
            {".md": 1},
        )
        self._write_snapshot("kickoff-after", after)

        with self.assertRaises(FileNotFoundError) as before_ctx:
            snapshot.diff_snapshot_files("kickoff-before", "kickoff-after", self.repo)
        self.assertIn("kickoff-before", str(before_ctx.exception))

        before = _fixture_snapshot(
            "kickoff-before",
            ["README.md"],
            {"(root)": 1},
            {".md": 1},
        )
        self._write_snapshot("kickoff-before", before)
        (snapshot.snapshot_dir(self.repo) / "kickoff-after.json").unlink()

        with self.assertRaises(FileNotFoundError) as after_ctx:
            snapshot.diff_snapshot_files("kickoff-before", "kickoff-after", self.repo)
        self.assertIn("kickoff-after", str(after_ctx.exception))

    def test_write_snapshot_rejects_traversal_label(self) -> None:
        with self.assertRaises(MetricsValidationError):
            snapshot.write_snapshot("../../x", self.repo)

        escaped = (self.repo.parent.parent / "x.json")
        self.assertFalse(escaped.exists())

    def test_load_snapshot_rejects_traversal_label(self) -> None:
        with self.assertRaises(MetricsValidationError):
            snapshot.load_snapshot("../../x", self.repo)

    def test_main_diff_mode_prints_valid_json(self) -> None:
        before = _fixture_snapshot(
            "kickoff-before",
            ["README.md"],
            {"(root)": 1},
            {".md": 1},
        )
        after = _fixture_snapshot(
            "kickoff-after",
            ["README.md", "src/app.py"],
            {"(root)": 1, "src": 1},
            {".md": 1, ".py": 1},
        )
        self._write_snapshot("kickoff-before", before)
        self._write_snapshot("kickoff-after", after)
        stdout = io.StringIO()

        with contextlib.redirect_stdout(stdout):
            exit_code = snapshot._main(
                ["--repo", str(self.repo), "--diff", "kickoff-before", "kickoff-after"]
            )

        self.assertEqual(exit_code, 0)
        rendered = json.loads(stdout.getvalue())
        self.assertEqual(rendered["before_label"], "kickoff-before")
        self.assertEqual(rendered["after_label"], "kickoff-after")
        self.assertEqual(rendered["files_added"], ["src/app.py"])


if __name__ == "__main__":
    unittest.main()
