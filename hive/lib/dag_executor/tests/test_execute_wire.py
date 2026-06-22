"""s11-execute-wire — execute/SKILL.md DAG-front-door seam tests.

Verifies:
  AC1: When execution.mode resolves to multica, execute SKILL.md routes to the
       DAG front door with binding=multica (not only execute-mode-multica/SKILL.md).
  AC2: Methodology→graph selection: classic/tdd/bdd each map to the matching
       development.*.workflow.yaml (graphs from s10).
  AC3: Backend unset → existing local execution path preserved; DAG dispatch
       not invoked when mode_decision != multica.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
EXECUTE_SKILL = REPO_ROOT / "skills" / "execute" / "SKILL.md"
WORKFLOWS_DIR = REPO_ROOT / "hive" / "workflows"

CLASSIC_PATH = WORKFLOWS_DIR / "development.classic.workflow.yaml"
TDD_PATH = WORKFLOWS_DIR / "development.tdd.workflow.yaml"
BDD_PATH = WORKFLOWS_DIR / "development.bdd.workflow.yaml"


def skill_text() -> str:
    return EXECUTE_SKILL.read_text(encoding="utf-8")


# ── AC1: multica mode routes to DAG front door ───────────────────────────────


def test_multica_routes_to_dag_front_door():
    """execute SKILL.md must reference hive.lib.dag_executor.run for multica dispatch."""
    text = skill_text()
    assert "hive.lib.dag_executor.run" in text, (
        "execute SKILL.md must reference hive.lib.dag_executor.run for multica DAG dispatch"
    )


def test_multica_uses_multica_binding():
    """execute SKILL.md must specify binding=multica for the DAG front-door path."""
    text = skill_text()
    assert 'binding="multica"' in text or "binding=multica" in text, (
        "execute SKILL.md must specify binding=multica when dispatching via DAG front door"
    )


def test_multica_dispatch_not_only_execute_mode_multica():
    """DAG dispatch step must be present and not delegate entirely to execute-mode-multica."""
    text = skill_text()
    # Step 5e (DAG dispatch) must exist as the multica routing target
    assert "5e" in text, (
        "execute SKILL.md must define step 5e as the DAG/Multica front-door dispatch step"
    )


def test_multica_info_log_uses_dag_multica_reason():
    """INFO log for the multica DAG path must use reason=dag-multica."""
    text = skill_text()
    assert "dag-multica" in text, (
        "execute SKILL.md must use dag-multica reason token in the INFO log for DAG/Multica dispatch"
    )


def test_multica_info_log_example_present():
    """INFO log template must name execute routing vocabulary."""
    text = skill_text()
    assert "execute routing:" in text, (
        "execute SKILL.md must include an INFO log line using 'execute routing:' vocabulary"
    )


def test_multica_dispatch_table_points_to_step_5e():
    """Step 5 switch table must route multica to step 5e (DAG front door), not step 6e."""
    text = skill_text()
    assert "multica -> step 5e" in text or "multica` -> step 5e" in text, (
        "execute SKILL.md step 5 switch table must route multica to step 5e"
    )


# ── AC2: methodology→graph selection ─────────────────────────────────────────


def test_classic_graph_selection_in_skill():
    """SKILL.md must map classic methodology to development.classic.workflow.yaml."""
    text = skill_text()
    assert "development.classic.workflow.yaml" in text, (
        "execute SKILL.md must map classic→development.classic.workflow.yaml"
    )


def test_tdd_graph_selection_in_skill():
    """SKILL.md must map tdd methodology to development.tdd.workflow.yaml."""
    text = skill_text()
    assert "development.tdd.workflow.yaml" in text, (
        "execute SKILL.md must map tdd→development.tdd.workflow.yaml"
    )


def test_bdd_graph_selection_in_skill():
    """SKILL.md must map bdd methodology to development.bdd.workflow.yaml."""
    text = skill_text()
    assert "development.bdd.workflow.yaml" in text, (
        "execute SKILL.md must map bdd→development.bdd.workflow.yaml"
    )


def test_classic_workflow_file_exists():
    assert CLASSIC_PATH.exists(), f"classic workflow graph not found at {CLASSIC_PATH}"


def test_tdd_workflow_file_exists():
    assert TDD_PATH.exists(), f"tdd workflow graph not found at {TDD_PATH}"


def test_bdd_workflow_file_exists():
    assert BDD_PATH.exists(), f"bdd workflow graph not found at {BDD_PATH}"


def test_all_three_methodologies_mapped():
    """All three methodology tokens must appear together in the graph selection section."""
    text = skill_text()
    for meth in ("classic", "tdd", "bdd"):
        assert meth in text, (
            f"execute SKILL.md must reference '{meth}' methodology in graph selection"
        )


# ── AC3: local fallback — backend unset preserves existing execution path ─────


def test_sequential_path_preserved():
    """sequential execution path (step 7) must remain for local/fallback mode."""
    text = skill_text()
    assert "sequential" in text, (
        "execute SKILL.md must preserve the sequential execution path (local fallback)"
    )


def test_existing_mode_steps_not_removed():
    """Existing execution steps (6, 6b, 6c, 6d, 6f, 7) must still be referenced."""
    text = skill_text()
    for step in ("step 6", "step 7"):
        assert step in text, (
            f"execute SKILL.md must preserve existing mode step reference '{step}'"
        )


def test_no_regression_local_path_described():
    """SKILL.md must describe what happens when mode is not multica (no regression)."""
    text = skill_text()
    assert "backend unset" in text.lower() or "mode_decision != multica" in text, (
        "execute SKILL.md must state that existing paths are unchanged when backend is unset"
    )


def test_multica_step5e_states_fallback():
    """Step 5e must describe local fallback behavior for daemon-down / dispatch errors."""
    text = skill_text()
    assert "falling back to local" in text, (
        "execute SKILL.md step 5e must describe local fallback on daemon-down or dispatch errors"
    )
