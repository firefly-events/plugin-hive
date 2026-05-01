"""Validator failure-mode tests using small inline-YAML fixtures.

Each test constructs a synthetic workflow YAML in a temp directory,
loads it through the loader, and asserts the validator raises the
expected typed error.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.graph import (
    CycleError,
    DanglingRefError,
    InvalidInputSourceError,
    TimeoutOutOfRangeError,
    TypeMismatchError,
    load_workflow,
    validate_graph,
)


def _write_workflow(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "synthetic.workflow.yaml"
    path.write_text(body, encoding="utf-8")
    return path


def test_cycle_error_two_node_loop(tmp_path: Path):
    body = """
name: cycle-test
version: "1.0.0"
steps:
  - id: a
    agent: developer
    depends_on: [b]
  - id: b
    agent: developer
    depends_on: [a]
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(CycleError) as excinfo:
        validate_graph(graph)
    assert "a" in excinfo.value.cycle_node_ids
    assert "b" in excinfo.value.cycle_node_ids


def test_cycle_error_three_node_loop(tmp_path: Path):
    body = """
name: cycle-3
version: "1.0.0"
steps:
  - id: a
    agent: developer
    depends_on: [c]
  - id: b
    agent: developer
    depends_on: [a]
  - id: c
    agent: developer
    depends_on: [b]
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(CycleError):
        validate_graph(graph)


def test_dangling_ref_error_via_depends_on(tmp_path: Path):
    body = """
name: dangling-test
version: "1.0.0"
steps:
  - id: a
    agent: developer
    depends_on: [does-not-exist]
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(DanglingRefError) as excinfo:
        validate_graph(graph)
    assert excinfo.value.referencing_node_id == "a"
    assert excinfo.value.missing_target_id == "does-not-exist"


def test_dangling_ref_error_via_input_step_id(tmp_path: Path):
    body = """
name: dangling-input
version: "1.0.0"
steps:
  - id: a
    agent: developer
    inputs:
      - name: upstream_value
        source: step_output
        step_id: phantom
        output_name: result
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(DanglingRefError) as excinfo:
        validate_graph(graph)
    assert excinfo.value.missing_target_id == "phantom"


def test_invalid_input_source_error(tmp_path: Path):
    body = """
name: bad-source
version: "1.0.0"
steps:
  - id: a
    agent: developer
    inputs:
      - name: bogus_input
        source: bogus
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(InvalidInputSourceError) as excinfo:
        validate_graph(graph)
    assert excinfo.value.bad_source == "bogus"
    assert excinfo.value.input_name == "bogus_input"


def test_type_mismatch_error_on_output(tmp_path: Path):
    body = """
name: bad-output
version: "1.0.0"
steps:
  - id: a
    agent: developer
    outputs:
      - name: result
        type: not-a-real-type
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(TypeMismatchError) as excinfo:
        validate_graph(graph)
    assert excinfo.value.bad_type == "not-a-real-type"


def test_timeout_below_floor(tmp_path: Path):
    body = """
name: timeout-low
version: "1.0.0"
steps:
  - id: a
    agent: developer
    timeout_ms: 500
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(TimeoutOutOfRangeError) as excinfo:
        validate_graph(graph)
    assert excinfo.value.timeout_ms == 500


def test_timeout_above_ceiling(tmp_path: Path):
    body = """
name: timeout-high
version: "1.0.0"
steps:
  - id: a
    agent: developer
    timeout_ms: 3600001
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    with pytest.raises(TimeoutOutOfRangeError) as excinfo:
        validate_graph(graph)
    assert excinfo.value.timeout_ms == 3600001


def test_timeout_at_boundary_passes(tmp_path: Path):
    body = """
name: timeout-ok
version: "1.0.0"
steps:
  - id: a
    agent: developer
    timeout_ms: 1000
  - id: b
    agent: developer
    timeout_ms: 3600000
    depends_on: [a]
"""
    graph = load_workflow(_write_workflow(tmp_path, body))
    validate_graph(graph)  # must not raise
