"""Relocated-state regression tests for DAG executor run-state (story sdr-7).

DAG executor transient run-state surfaces (run-state store, worktree
isolation root, nesting paths, pause-state path) must resolve through the
sdr-1 resolver (HIVE_STATE_DIR env > paths.state_dir in hive.config.yaml >
default .pHive), per call rather than frozen at import time.

Q1 is binding: the executor opt-in config (`.pHive/hive.config.yaml`) and
the graduation registry (`.pHive/runtime/executor-graduated-workflows.yaml`)
are FIXED policy locks — the negative tests here prove they did not move
when the state dir is relocated.

Run: python3 -m unittest tests.test_dag_runstate_state_dir_adoption -v
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from hive.lib.dag_executor import (
    CONSUMER_CONFIG_PATH,
    GRADUATED_REGISTRY_PATH,
    executor_enabled_for,
    is_workflow_graduated,
    load_executor_config,
)
from hive.lib.dag_executor.executor.handlers.pause import PauseHandler
from hive.lib.dag_executor.isolation.nesting import decide_run_worktree
from hive.lib.dag_executor.isolation.worktree import WorktreeManager
from hive.lib.dag_executor.run_state import store

RESOLVER_ENV_KEYS = ("HIVE_STATE_DIR", "CONFIG_FILE", "HIVE_ROOT")

# Canonical `<26-char ULID>-<slug>` shape per run_id.py contract.
RUN_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV-sdr7"


class _RelocatedStateCase(unittest.TestCase):
    """Shared setup: canonical temp project dir, scrubbed resolver env, chdir."""

    def setUp(self) -> None:
        tmp = tempfile.mkdtemp(prefix="sdr7-dag-")
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

    def configure_state_dir(self, value: str) -> Path:
        """Write `paths.state_dir` into the project hive.config.yaml."""
        (self.root / "hive.config.yaml").write_text(
            f"paths:\n  state_dir: {value}\n", encoding="utf-8"
        )
        return self.root / value

    def assert_no_default_decoy(self) -> None:
        """A relocated run must not leak anything into default .pHive/runs."""
        self.assertFalse(
            (self.root / ".pHive" / "runs").exists(),
            "relocated run-state leaked into default .pHive/runs",
        )


class TestRunStateRelocation(_RelocatedStateCase):
    def test_run_state_lands_under_config_state_dir(self) -> None:
        state_dir = self.configure_state_dir(".hive-state")
        state = store.create(RUN_ID, "demo-workflow")
        store.save(state)
        expected = state_dir / "runs" / RUN_ID / "run_state.yaml"
        self.assertTrue(expected.is_file(), f"missing {expected}")
        self.assert_no_default_decoy()
        loaded = store.load(RUN_ID)
        self.assertEqual(loaded.run_id, RUN_ID)

    def test_run_state_lands_under_env_state_dir(self) -> None:
        env_dir = self.root / "env-state"
        os.environ["HIVE_STATE_DIR"] = str(env_dir)
        state = store.create(RUN_ID, "demo-workflow")
        store.save(state)
        self.assertTrue(
            (env_dir / "runs" / RUN_ID / "run_state.yaml").is_file()
        )
        self.assert_no_default_decoy()

    def test_default_unchanged_without_configuration(self) -> None:
        state = store.create(RUN_ID, "demo-workflow")
        store.save(state)
        self.assertTrue(
            (self.root / ".pHive" / "runs" / RUN_ID / "run_state.yaml").is_file(),
            "default .pHive/runs behavior changed with no state-dir config",
        )

    def test_suspend_and_resume_durable_under_relocated_runs(self) -> None:
        """mark_suspended → reload → unfreeze_for_resume stays in <state_dir>/runs."""
        state_dir = self.configure_state_dir("relocated")
        state = store.create(RUN_ID, "demo-workflow")
        store.save(state)
        suspended = store.mark_suspended(state)
        store.save(suspended)

        run_file = state_dir / "runs" / RUN_ID / "run_state.yaml"
        self.assertTrue(run_file.is_file())

        reloaded = store.load(RUN_ID)
        self.assertTrue(reloaded.frozen)
        revived = store.unfreeze_for_resume(reloaded)
        self.assertFalse(revived.frozen)
        store.save(revived)
        self.assertTrue(run_file.is_file())
        self.assert_no_default_decoy()


class TestIsolationRelocation(_RelocatedStateCase):
    def _init_git_repo(self) -> Path:
        repo = self.root / "repo"
        repo.mkdir()
        env = {**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
        for args in (
            ["git", "init", "-q"],
            ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"],
        ):
            subprocess.run(args, cwd=repo, check=True, env=env, capture_output=True)
        return repo

    def test_worktree_manager_default_root_relocates(self) -> None:
        repo = self._init_git_repo()
        env_dir = self.root / "wt-state"
        os.environ["HIVE_STATE_DIR"] = str(env_dir)
        manager = WorktreeManager(repo_path=repo)
        self.assertEqual(manager.runs_root, env_dir / "runs")
        target = manager.create(RUN_ID)
        self.assertEqual(target, env_dir / "runs" / RUN_ID)
        self.assertTrue(target.is_dir())
        self.assertFalse((repo / ".pHive" / "runs").exists())
        manager.cleanup_success(RUN_ID)

    def test_worktree_manager_explicit_root_still_wins(self) -> None:
        repo = self._init_git_repo()
        os.environ["HIVE_STATE_DIR"] = str(self.root / "ignored")
        explicit = self.root / "explicit-runs"
        manager = WorktreeManager(repo_path=repo, runs_root=explicit)
        self.assertEqual(manager.runs_root, explicit)

    def test_nesting_fresh_path_relocates(self) -> None:
        repo = self._init_git_repo()
        env_dir = self.root / "nest-state"
        os.environ["HIVE_STATE_DIR"] = str(env_dir)
        decision = decide_run_worktree(RUN_ID, repo_path=repo)
        self.assertTrue(decision.owned_by_us)
        self.assertFalse(decision.reused_outer)
        self.assertEqual(decision.path, env_dir / "runs" / RUN_ID)

    def test_nesting_default_unchanged_without_configuration(self) -> None:
        repo = self._init_git_repo()
        decision = decide_run_worktree(RUN_ID, repo_path=repo)
        self.assertEqual(decision.path, repo / ".pHive" / "runs" / RUN_ID)


class TestPauseRelocation(_RelocatedStateCase):
    def test_pause_handler_default_root_relocates(self) -> None:
        env_dir = self.root / "pause-state"
        os.environ["HIVE_STATE_DIR"] = str(env_dir)
        handler = PauseHandler()
        self.assertEqual(handler.runs_root, env_dir / "runs")

    def test_pause_handler_default_unchanged_without_configuration(self) -> None:
        handler = PauseHandler()
        self.assertEqual(handler.runs_root, self.root / ".pHive" / "runs")

    def test_pause_handler_explicit_root_still_wins(self) -> None:
        os.environ["HIVE_STATE_DIR"] = str(self.root / "ignored")
        explicit = self.root / "explicit-runs"
        handler = PauseHandler(runs_root=explicit)
        self.assertEqual(handler.runs_root, explicit)


class TestFixedLocksDidNotMove(_RelocatedStateCase):
    """Q1 negative coverage: policy locks stay at .pHive even when the
    state dir is relocated via env or config."""

    def test_lock_constants_remain_literal_phive_paths(self) -> None:
        os.environ["HIVE_STATE_DIR"] = str(self.root / "elsewhere")
        self.assertEqual(CONSUMER_CONFIG_PATH, Path(".pHive/hive.config.yaml"))
        self.assertEqual(
            GRADUATED_REGISTRY_PATH,
            Path(".pHive/runtime/executor-graduated-workflows.yaml"),
        )

    def test_executor_opt_in_reads_fixed_phive_config(self) -> None:
        """Opt-in policy read from .pHive/hive.config.yaml regardless of a
        relocated state dir — a copy at the relocated dir is ignored."""
        relocated = self.root / "elsewhere"
        os.environ["HIVE_STATE_DIR"] = str(relocated)

        fixed = self.root / ".pHive"
        fixed.mkdir(parents=True)
        (fixed / "hive.config.yaml").write_text(
            "executor: hive-dag\nexecutor_default: on\n", encoding="utf-8"
        )
        # Decoy at the relocated state dir that would flip the answer if
        # the lock had (incorrectly) moved.
        relocated.mkdir(parents=True)
        (relocated / "hive.config.yaml").write_text(
            "executor: bogus\nexecutor_default: off\n", encoding="utf-8"
        )

        cfg = load_executor_config(self.root)
        self.assertTrue(cfg["_present"])
        self.assertEqual(cfg["executor"], "hive-dag")
        self.assertTrue(cfg["executor_default"])

    def test_graduation_registry_reads_fixed_phive_runtime_path(self) -> None:
        relocated = self.root / "elsewhere"
        os.environ["HIVE_STATE_DIR"] = str(relocated)

        fixed_runtime = self.root / ".pHive" / "runtime"
        fixed_runtime.mkdir(parents=True)
        (fixed_runtime / "executor-graduated-workflows.yaml").write_text(
            "workflows:\n  - demo-workflow\n", encoding="utf-8"
        )
        # Decoy registry at the relocated dir — must NOT be honored.
        decoy_runtime = relocated / "runtime"
        decoy_runtime.mkdir(parents=True)
        (decoy_runtime / "executor-graduated-workflows.yaml").write_text(
            "workflows:\n  - decoy-workflow\n", encoding="utf-8"
        )

        self.assertTrue(is_workflow_graduated("demo-workflow", self.root))
        self.assertFalse(is_workflow_graduated("decoy-workflow", self.root))

    def test_executor_enabled_for_uses_fixed_locks_under_relocation(self) -> None:
        os.environ["HIVE_STATE_DIR"] = str(self.root / "elsewhere")
        fixed = self.root / ".pHive"
        (fixed / "runtime").mkdir(parents=True)
        (fixed / "hive.config.yaml").write_text(
            "executor: hive-dag\nexecutor_default: on\n", encoding="utf-8"
        )
        (fixed / "runtime" / "executor-graduated-workflows.yaml").write_text(
            "workflows:\n  - demo-workflow\n", encoding="utf-8"
        )
        self.assertTrue(executor_enabled_for("demo-workflow", self.root))


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
