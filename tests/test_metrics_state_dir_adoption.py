"""Relocated-state regression tests for the metrics cluster (story sdr-3).

Python metrics readers/writers must resolve through the sdr-1 resolver
(METRICS_ROOT seam > HIVE_STATE_DIR env > paths.state_dir in hive.config.yaml
> default .pHive), per call rather than frozen at import time. The
cross-runtime test proves the writer-moves-reader-stays-default trap is
closed: a shell-hook-style write (state dir derived via hooks/common.sh
_resolve_state_dir) lands where BOTH the Python metrics reader and the Node
budget-gate reader look, under a custom configured state dir.

Run: python3 -m unittest tests.test_metrics_state_dir_adoption -v
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from hive.lib.kg_metrics_writer import (
    default_kg_metrics_dir,
    flush_cycle,
    reset_buffer_for_test,
)
from hive.lib.metrics.paths import get_metrics_root

ROOT = Path(__file__).resolve().parents[1]
COMMON_SH_PATH = ROOT / "hooks" / "common.sh"
BUDGET_GATE_PATH = ROOT / "hive" / "lib" / "budget-gate.js"

RESOLVER_ENV_KEYS = ("METRICS_ROOT", "HIVE_STATE_DIR", "CONFIG_FILE", "HIVE_ROOT")


class _RelocatedStateCase(unittest.TestCase):
    """Shared setup: canonical temp project dir, scrubbed resolver env, chdir."""

    def setUp(self) -> None:
        tmp = tempfile.mkdtemp(prefix="sdr3-metrics-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        # realpath so macOS /var → /private/var symlinks don't confuse asserts
        # (the resolver canonicalizes its output).
        self.root = Path(os.path.realpath(tmp))

        prior_env = {key: os.environ.get(key) for key in RESOLVER_ENV_KEYS}

        def _restore_env() -> None:
            for key, value in prior_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

        self.addCleanup(_restore_env)
        for key in RESOLVER_ENV_KEYS:
            os.environ.pop(key, None)

        prior_cwd = os.getcwd()
        self.addCleanup(os.chdir, prior_cwd)
        os.chdir(self.root)

    def write_config(self, state_dir: str = "custom-state") -> None:
        (self.root / "hive.config.yaml").write_text(
            f"paths:\n  state_dir: {state_dir}\n", encoding="utf-8"
        )


class MetricsRootResolutionTest(_RelocatedStateCase):
    def test_configured_state_dir_moves_metrics_root(self) -> None:
        self.write_config("custom-state")
        self.assertEqual(
            get_metrics_root(), self.root / "custom-state" / "metrics"
        )

    def test_hive_state_dir_env_wins_over_config(self) -> None:
        self.write_config("config-state")
        os.environ["HIVE_STATE_DIR"] = str(self.root / "env-state")
        self.assertEqual(get_metrics_root(), self.root / "env-state" / "metrics")

    def test_metrics_root_seam_wins_over_resolver(self) -> None:
        self.write_config("config-state")
        os.environ["METRICS_ROOT"] = str(self.root / "seam-root")
        self.assertEqual(get_metrics_root(), self.root / "seam-root")

    def test_no_env_no_config_default_unchanged(self) -> None:
        self.assertEqual(get_metrics_root(), self.root / ".pHive" / "metrics")


class KgMetricsWriterResolutionTest(_RelocatedStateCase):
    def setUp(self) -> None:
        super().setUp()
        reset_buffer_for_test()
        self.addCleanup(reset_buffer_for_test)

    def test_default_dir_follows_configured_state_dir(self) -> None:
        self.write_config("custom-state")
        self.assertEqual(
            default_kg_metrics_dir(),
            self.root / "custom-state" / "metrics" / "kg",
        )
        out_path = flush_cycle(
            cycle_id="sdr3-cycle",
            findings=1,
            proposals=1,
            hit_rate_5cycle=0.5,
        )
        self.assertEqual(
            out_path,
            self.root / "custom-state" / "metrics" / "kg" / "sdr3-cycle.jsonl",
        )
        self.assertTrue(out_path.exists())
        # Decoy assertion: legacy default tree untouched.
        self.assertFalse((self.root / ".pHive" / "metrics" / "kg").exists())

    def test_default_dir_without_config_unchanged(self) -> None:
        self.assertEqual(
            default_kg_metrics_dir(), self.root / ".pHive" / "metrics" / "kg"
        )

    def test_explicit_metrics_dir_still_wins(self) -> None:
        self.write_config("custom-state")
        explicit = self.root / "elsewhere"
        out_path = flush_cycle(
            cycle_id="sdr3-explicit",
            findings=0,
            proposals=0,
            hit_rate_5cycle=0.0,
            miss_reason="none",
            metrics_dir=explicit,
        )
        self.assertEqual(out_path, explicit / "sdr3-explicit.jsonl")


class CrossRuntimeSameTreeTest(_RelocatedStateCase):
    """Shell writer, Node reader, Python reader — one configured tree."""

    def _shell_write_stop_event(self, row_json: str) -> str:
        """Derive the state dir exactly as the metrics hooks do (source
        hooks/common.sh, call _resolve_state_dir) and append one stop-event
        row under <state-dir>/metrics/events, mirroring the hooks' write
        path. Returns the shell-resolved state dir."""
        script = (
            'cd "$1" && . "$2" && HIVE_ROOT="" && '
            "state_dir=$(_resolve_state_dir) && "
            'mkdir -p "$state_dir/metrics/events" && '
            'printf \'%s\\n\' "$3" >> "$state_dir/metrics/events/stop-shell.jsonl" && '
            'printf \'%s\' "$state_dir"'
        )
        result = subprocess.run(
            ["bash", "-c", script, "_", str(self.root), str(COMMON_SH_PATH), row_json],
            env={
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "HOME": os.environ.get("HOME", str(self.root)),
            },
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(
            result.returncode, 0, msg=f"shell writer failed: {result.stderr!r}"
        )
        return result.stdout.strip()

    def _node_spend(self) -> float:
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not available")
        # cwd is argv[1] (not the module path) so budget-gate's run-as-main
        # guard, which compares argv[1] against its own file URL, stays off.
        script = (
            "import(process.argv[2]).then((m) => {"
            "  const spend = m.computeDailySpend({"
            "    cwd: process.argv[1], env: {}, warn: () => {} });"
            "  console.log(spend.toFixed(4));"
            "}).catch((e) => { console.error(e); process.exit(1); });"
        )
        result = subprocess.run(
            [node, "-e", script, str(self.root), str(BUDGET_GATE_PATH)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(
            result.returncode, 0, msg=f"node reader failed: {result.stderr!r}"
        )
        return float(result.stdout.strip())

    def test_shell_writer_and_node_python_readers_share_one_tree(self) -> None:
        self.write_config("custom-state")
        now_iso = (
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        )
        # Opus 1M input × $15/MTok = $15.00 for today's UTC day.
        row = json.dumps(
            {
                "timestamp": now_iso,
                "metric_type": "tokens",
                "value": 1_000_000,
                "dimensions": {
                    "model": "claude-opus-4-8",
                    "input_tokens": 1_000_000,
                    "output_tokens": 0,
                },
            }
        )
        shell_state_dir = self._shell_write_stop_event(row)

        # All three runtimes agree on the tree.
        self.assertEqual(shell_state_dir, str(self.root / "custom-state"))
        self.assertEqual(
            get_metrics_root(), Path(shell_state_dir) / "metrics"
        )
        self.assertTrue(
            (get_metrics_root() / "events" / "stop-shell.jsonl").exists()
        )
        # Legacy default tree untouched — the divergence trap is closed.
        self.assertFalse((self.root / ".pHive").exists())

        self.assertAlmostEqual(self._node_spend(), 15.0, places=4)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
