"""hde-9b — per-workflow graduation registry, real-file integration tests.

The hde-9a tests at `test_consumer_config_flag.py` already cover the
truth table by writing fixture registries into tmp_paths. This file
adds two new layers:

1. **Real-file canonical-shape tests.** A fresh tmp directory has the
   *exact* `workflows: []` registry shape from the canonical file
   (`.pHive/runtime/executor-graduated-workflows.yaml`) copied in;
   the wrapper helpers must read it without errors.

2. **Repo-canonical-file tests.** The shipped `.pHive/runtime/...`
   registry that hde-9b lands MUST be readable by the wrapper at the
   real `repo_root`. This is the integration-level guarantee that
   `skills/execute` can call back into `executor_enabled_for(...)`
   against the real file.

Per-workflow gating, missing-file default-safe, malformed fail-closed,
and add/remove-then-rollback behaviour are exercised end-to-end through
the public surface — no mocks, no in-process registry stub.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from hive.lib.dag_executor import (
    GRADUATED_REGISTRY_PATH,
    executor_enabled_for,
    is_workflow_graduated,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_REGISTRY = REPO_ROOT / GRADUATED_REGISTRY_PATH


def _seed_consumer_repo(root: Path, *, flag_on: bool) -> None:
    """Materialise a tmp consumer repo with the canonical hide-9a flag
    file and a fresh copy of the canonical hde-9b registry."""

    config_path = root / ".pHive" / "hive.config.yaml"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "executor: hive-dag\n"
        f"executor_default: {'true' if flag_on else 'false'}\n",
        encoding="utf-8",
    )
    registry_path = root / GRADUATED_REGISTRY_PATH
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(CANONICAL_REGISTRY, registry_path)


# ---------------------------------------------------------------------------
# Canonical-file integrity (the file landed by this story)
# ---------------------------------------------------------------------------


def test_canonical_registry_file_exists() -> None:
    """The hde-9b deliverable — the registry file must ship at the
    consumer-side path. Other slices add workflows to it; this story
    just creates the empty container."""

    assert CANONICAL_REGISTRY.is_file(), (
        f"canonical graduation registry missing: {CANONICAL_REGISTRY}"
    )


def test_canonical_registry_yaml_loads_to_workflows_list() -> None:
    """Schema parity with hde-9a's reader. The wrapper expects the
    top-level `workflows:` list shape; the canonical file must satisfy
    that contract directly (not via the malformed-file fail-closed
    branch). Any maintainer who renames the key (e.g. to
    `graduated_workflows:`) would silently break every downstream
    graduation; this test catches that."""

    import yaml

    parsed = yaml.safe_load(CANONICAL_REGISTRY.read_text(encoding="utf-8"))
    assert isinstance(parsed, dict), (
        "canonical registry must parse as a YAML mapping; got "
        f"{type(parsed).__name__}"
    )
    assert "workflows" in parsed, (
        "canonical registry must contain top-level `workflows:` key "
        "(hde-9a wrapper contract at hive/lib/dag_executor/__init__.py)"
    )
    assert "graduated_workflows" not in parsed, (
        "spec drift guard: the canonical key is `workflows:`, not "
        "`graduated_workflows:` (hde-9b lock)"
    )
    assert isinstance(parsed["workflows"], list), (
        f"`workflows:` must be a list; got {type(parsed['workflows']).__name__}"
    )


# ---------------------------------------------------------------------------
# Real-file end-to-end gating (no mocks, real wrapper, real file path)
# ---------------------------------------------------------------------------


def test_empty_registry_plus_flag_on_routes_orchestrator(tmp_path: Path) -> None:
    """Empty `workflows: []` + flag-on → orchestrator path for any
    workflow. The flag alone is not enough; per-workflow opt-in is
    required."""

    _seed_consumer_repo(tmp_path, flag_on=True)
    # Override the seeded (canonical) registry with an explicitly empty
    # one; the canonical file ships graduated workflows post-Order-1.
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH
    registry_path.write_text("workflows: []\n", encoding="utf-8")
    assert executor_enabled_for("code-review", tmp_path) is False
    assert executor_enabled_for("meta-team-cycle", tmp_path) is False
    assert executor_enabled_for("test-swarm", tmp_path) is False


def test_registry_with_code_review_routes_executor(tmp_path: Path) -> None:
    """Registry containing `code-review` + flag-on + invocation for
    `code-review` → executor path."""

    _seed_consumer_repo(tmp_path, flag_on=True)
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH
    registry_path.write_text("workflows:\n  - code-review\n", encoding="utf-8")

    assert executor_enabled_for("code-review", tmp_path) is True


def test_registry_with_code_review_other_workflows_orchestrator(
    tmp_path: Path,
) -> None:
    """Same registry + invocation for `meta-team-cycle` (NOT in registry)
    → orchestrator path. Per-workflow gate is strict."""

    _seed_consumer_repo(tmp_path, flag_on=True)
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH
    registry_path.write_text("workflows:\n  - code-review\n", encoding="utf-8")

    assert executor_enabled_for("meta-team-cycle", tmp_path) is False
    assert executor_enabled_for("test-swarm", tmp_path) is False


def test_add_then_remove_rolls_back_only_that_workflow(tmp_path: Path) -> None:
    """Add `code-review` then remove via direct edit → orchestrator path
    post-remove. Other workflows untouched. Per-workflow rollback is the
    locked behaviour for the cutover sequence (any single workflow can
    be reverted without touching the rest of the registry)."""

    _seed_consumer_repo(tmp_path, flag_on=True)
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH

    # Add: code-review + test-swarm both graduated.
    registry_path.write_text(
        "workflows:\n  - code-review\n  - test-swarm\n",
        encoding="utf-8",
    )
    assert executor_enabled_for("code-review", tmp_path) is True
    assert executor_enabled_for("test-swarm", tmp_path) is True

    # Remove ONLY code-review by direct edit.
    registry_path.write_text("workflows:\n  - test-swarm\n", encoding="utf-8")

    # code-review rolled back; test-swarm still graduated.
    assert executor_enabled_for("code-review", tmp_path) is False
    assert executor_enabled_for("test-swarm", tmp_path) is True


def test_missing_registry_file_defaults_safe(tmp_path: Path) -> None:
    """Missing registry file → treated as empty list, no error,
    orchestrator path. Default-safe behaviour is the locked invariant
    (matches the missing-flag-file behaviour in hde-9a)."""

    config_path = tmp_path / ".pHive" / "hive.config.yaml"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "executor: hive-dag\nexecutor_default: true\n",
        encoding="utf-8",
    )
    # NOTE: no registry file written.

    assert is_workflow_graduated("code-review", tmp_path) is False
    assert executor_enabled_for("code-review", tmp_path) is False


def test_malformed_registry_fails_closed_to_orchestrator(tmp_path: Path) -> None:
    """Yaml-invalid registry → fail-closed orchestrator path with no
    error raised to the skill caller. Same skip-on-malformed pattern as
    the hde-9a config reader; a partial allow-list would be worse than
    none."""

    _seed_consumer_repo(tmp_path, flag_on=True)
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH
    # Definitely not valid YAML — unbalanced colons + tab inside flow.
    registry_path.write_text("workflows: : :\n\t- bad\n", encoding="utf-8")

    assert is_workflow_graduated("code-review", tmp_path) is False
    assert executor_enabled_for("code-review", tmp_path) is False


def test_registry_wrong_top_level_shape_fails_closed(tmp_path: Path) -> None:
    """Schema-mismatch (e.g. registry written with the wrong top-level
    key, or as a bare scalar) must fail closed to empty rather than
    silently accept. Defends future maintainers from introducing a new
    key without updating the wrapper."""

    _seed_consumer_repo(tmp_path, flag_on=True)
    registry_path = tmp_path / GRADUATED_REGISTRY_PATH

    # Bare scalar.
    registry_path.write_text("just-a-scalar\n", encoding="utf-8")
    assert is_workflow_graduated("code-review", tmp_path) is False

    # Wrong top-level key.
    registry_path.write_text(
        "graduated_workflows:\n  - code-review\n",
        encoding="utf-8",
    )
    assert is_workflow_graduated("code-review", tmp_path) is False

    # `workflows:` present but not a list.
    registry_path.write_text("workflows:\n  code-review: true\n", encoding="utf-8")
    assert is_workflow_graduated("code-review", tmp_path) is False
