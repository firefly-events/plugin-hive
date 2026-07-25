"""Risk #2 HIGH defense — agent handler must NOT bypass agent-spawn.

These tests use a spy/mock as the spawn callable and assert the EXACT
invocation shape passed in. They guard against:
  * Loader-side resolution leaking into the handler (raw `developer`
    must reach agent-spawn unchanged).
  * step_file content being summarised, paraphrased, or trimmed.
  * run_id and step_id failing to propagate.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.errors import AgentHandlerError
from hive.lib.dag_executor.executor.handlers.agent import (
    AgentHandler,
    NodeOutput,
    StubAgentSpawn,
)
from hive.lib.dag_executor.graph import Node, NodeType, OutputRef


def _make_node(step_file: str | None = None) -> Node:
    return Node(
        id="implement",
        agent="developer",  # generic — must NOT be pre-resolved
        node_type=NodeType.AGENT,
        step_file=step_file,
    )


def test_raw_agent_string_preserved_through_dispatch():
    spy = StubAgentSpawn(canned_outputs={"implement": {"summary": "ok"}})
    handler = AgentHandler(spawn=spy)
    handler.handle(_make_node(), inputs={}, run_id="rid-1")

    assert len(spy.calls) == 1
    call = spy.calls[0]
    # Risk #2 HIGH: generic `developer` MUST reach agent-spawn raw.
    assert call["agent"] == "developer", (
        f"agent string was resolved before agent-spawn dispatch: {call['agent']!r}"
    )
    assert call["run_id"] == "rid-1"
    assert call["step_id"] == "implement"


def test_step_file_content_passed_verbatim(tmp_path: Path):
    step_file = tmp_path / "step.md"
    content = (
        "# Step file\n\n"
        "**Bold marker** — must survive verbatim.\n\n"
        "```python\nx = 1  # don't paraphrase me\n```\n"
        "Trailing whitespace too:    \n"
    )
    step_file.write_text(content, encoding="utf-8")

    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)
    handler.handle(_make_node(step_file=str(step_file)), inputs={}, run_id="rid-1")

    call = spy.calls[0]
    assert call["step_file_content"] == content, (
        "step_file content was transformed before agent-spawn dispatch"
    )


def test_step_file_resolves_relative_to_repo_root(tmp_path: Path):
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    rel = Path("hive/workflows/steps/sample.md")
    full = repo_root / rel
    full.parent.mkdir(parents=True)
    full.write_text("hello world", encoding="utf-8")

    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy, repo_root=repo_root)
    handler.handle(_make_node(step_file=str(rel)), inputs={}, run_id="rid-1")

    assert spy.calls[0]["step_file_content"] == "hello world"


def test_missing_step_file_raises_agent_handler_error(tmp_path: Path):
    handler = AgentHandler(spawn=StubAgentSpawn())
    missing = tmp_path / "does-not-exist.md"
    with pytest.raises(AgentHandlerError):
        handler.handle(_make_node(step_file=str(missing)), inputs={}, run_id="rid-1")


def test_step_file_resolves_from_plugin_root_not_repo_root(tmp_path: Path):
    """A plugin-shipped step_file lives under the plugin root, NOT the
    consumer project's repo_root. It must resolve from plugin_root even when
    repo_root (a different project dir) does not contain it. Guards the
    consumer-project case: planning a separate repo with the installed plugin.
    """
    plugin_root = tmp_path / "plugin"
    rel = Path("hive/workflows/step-files/plan/research.md")
    full = plugin_root / rel
    full.parent.mkdir(parents=True)
    full.write_text("plan research step", encoding="utf-8")

    repo_root = tmp_path / "consumer-project"  # does NOT contain the step_file
    repo_root.mkdir()

    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy, repo_root=repo_root, plugin_root=plugin_root)
    handler.handle(_make_node(step_file=str(rel)), inputs={}, run_id="rid-1")

    assert spy.calls[0]["step_file_content"] == "plan research step"


def test_harvest_git_state_derives_sha_branch_repo(tmp_path: Path):
    """#7: Multica's task API doesn't report the agent's commit/push, so
    MulticaAgentSpawn derives sha/branch/repo from the git HEAD of the agent's
    work_dir checkout. The repo is a subdir under work_dir.
    """
    import subprocess as sp

    from hive.lib.dag_executor.executor.handlers.agent import MulticaAgentSpawn

    work_dir = tmp_path / "task-work"
    repo = work_dir / "the-project"
    repo.mkdir(parents=True)

    def git(*args: str) -> None:
        sp.run(["git", "-C", str(repo), *args], check=True, capture_output=True)

    git("init", "-q")
    git("config", "user.email", "t@t")
    git("config", "user.name", "t")
    git("checkout", "-q", "-b", "feat/my-epic")
    (repo / "f.txt").write_text("x", encoding="utf-8")
    git("add", "-A")
    git("commit", "-q", "-m", "c")

    # _harvest_git_state is an instance method (it consults self._target_branch).
    # With repo_root unset the target is "" so it falls back to HEAD — which here
    # IS feat/my-epic, preserving the original assertions.
    spawn = MulticaAgentSpawn(
        cli_path=tmp_path / "cli.mjs", repo_root=tmp_path / "non-git-root"
    )
    state = spawn._harvest_git_state(str(work_dir))
    assert state["branch"] == "feat/my-epic"
    assert state["commit_sha"] == state["code_push_sha"]
    assert len(state["commit_sha"]) == 40
    assert state["repo"] == str(repo)
    assert spawn._harvest_git_state(None) == {}


def test_step_file_outside_all_roots_raises(tmp_path: Path):
    """An absolute path escaping every allowed root (plugin_root + repo_root)
    must NOT be read — preserves the no-arbitrary-file-read guard.
    """
    plugin_root = tmp_path / "plugin"
    plugin_root.mkdir()
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    secret = tmp_path / "outside" / "secret.md"
    secret.parent.mkdir(parents=True)
    secret.write_text("should not be read", encoding="utf-8")

    handler = AgentHandler(spawn=StubAgentSpawn(), repo_root=repo_root, plugin_root=plugin_root)
    with pytest.raises(AgentHandlerError):
        handler.handle(_make_node(step_file=str(secret)), inputs={}, run_id="rid-1")


def test_inputs_propagate_to_spawn():
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)
    inputs = {"diff": "<<diff>>", "scope_analysis": {"files_changed": 3}}
    handler.handle(_make_node(), inputs=inputs, run_id="rid-1")

    assert spy.calls[0]["inputs"] == inputs


@pytest.mark.parametrize("story_spec", [None, "", "   ", {}, []])
def test_null_or_empty_story_spec_halts_before_dispatch(story_spec):
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)

    with pytest.raises(AgentHandlerError) as exc_info:
        handler.handle(
            _make_node(),
            inputs={"story_id": "s3-min-version-gate", "story_spec": story_spec},
            run_id="rid-rerun",
        )

    assert str(exc_info.value) == (
        "story_spec is null/empty for story=s3-min-version-gate — "
        "refusing to dispatch a spec-less agent"
    )
    assert spy.calls == []


def test_missing_story_spec_halts_before_dispatch_when_story_id_present():
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)

    with pytest.raises(AgentHandlerError, match="story_spec is null/empty"):
        handler.handle(
            _make_node(),
            inputs={"story_id": "s4-null-spec-fail-loud-guard"},
            run_id="rid-missing-spec",
        )

    assert spy.calls == []


def test_node_with_no_step_file_passes_empty_string():
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy)
    handler.handle(_make_node(), inputs={}, run_id="rid-1")
    assert spy.calls[0]["step_file_content"] == ""


def test_handler_returns_node_output_with_canned_outputs():
    spy = StubAgentSpawn(canned_outputs={"implement": {"verdict": "ok"}})
    handler = AgentHandler(spawn=spy)
    out = handler.handle(_make_node(), inputs={}, run_id="rid-1")
    assert isinstance(out, NodeOutput)
    assert out.outputs == {"verdict": "ok"}


def test_non_dict_spawn_return_raises():
    def bad_spawn(**_kwargs):
        return "not-a-dict"

    handler = AgentHandler(spawn=bad_spawn)
    with pytest.raises(AgentHandlerError):
        handler.handle(_make_node(), inputs={}, run_id="rid-1")


def _write_bound_persona(
    root: Path, *, skill_name: str, persona_name: str = "reviewer"
) -> Path:
    persona = root / "hive" / "agents" / f"{persona_name}.md"
    persona.parent.mkdir(parents=True, exist_ok=True)
    persona.write_text(
        "---\n"
        f"name: {persona_name}\n"
        "skills:\n"
        f"  - path: ${{CLAUDE_PLUGIN_ROOT}}/skills/{skill_name}/SKILL.md\n"
        f"    use-when: running {skill_name}\n"
        "---\n",
        encoding="utf-8",
    )
    skill = root / "skills" / skill_name / "SKILL.md"
    skill.parent.mkdir(parents=True, exist_ok=True)
    skill.write_text(f"# {skill_name} trusted procedure\n", encoding="utf-8")
    return persona


def test_bound_skill_uses_persona_trust_root_not_ambient_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    plugin = tmp_path / "trusted-plugin"
    consumer = tmp_path / "consumer"
    _write_bound_persona(plugin, skill_name="review")
    evil = consumer / "skills" / "review" / "SKILL.md"
    evil.parent.mkdir(parents=True)
    evil.write_text("EXFILTRATE_CONSUMER_SECRETS", encoding="utf-8")
    monkeypatch.setenv("CLAUDE_PLUGIN_ROOT", str(consumer))

    node = Node(
        id="review",
        agent="reviewer",
        node_type=NodeType.AGENT,
        config={
            "skill_binding": {
                "persona_path": "hive/agents/reviewer.md",
                "trigger": "running review",
            }
        },
    )
    spy = StubAgentSpawn()
    handler = AgentHandler(spawn=spy, plugin_root=plugin, repo_root=consumer)
    handler.handle(node, inputs={}, run_id="rid-trust")

    prompt = spy.calls[0]["step_file_content"]
    assert "review trusted procedure" in prompt
    assert "EXFILTRATE_CONSUMER_SECRETS" not in prompt


def test_bound_skill_declared_outputs_fail_closed_on_local_spawn(tmp_path: Path):
    plugin = tmp_path / "plugin"
    _write_bound_persona(plugin, skill_name="verify")
    node = Node(
        id="reviewer",
        agent="reviewer",
        node_type=NodeType.AGENT,
        config={
            "skill_binding": {
                "persona_path": "hive/agents/reviewer.md",
                "trigger": "running verify",
            }
        },
        outputs=[
            OutputRef(name="skill_invoked", type="json"),
            OutputRef(name="verify_evidence", type="string"),
        ],
    )
    handler = AgentHandler(
        spawn=StubAgentSpawn(canned_outputs={"reviewer": {}}),
        plugin_root=plugin,
    )

    with pytest.raises(AgentHandlerError, match="verify_evidence"):
        handler.handle(node, inputs={}, run_id="rid-verify")


def test_observe_binding_enables_runtime_contract_automatically(tmp_path: Path):
    plugin = tmp_path / "plugin"
    _write_bound_persona(plugin, skill_name="observe", persona_name="pair-programmer")
    node = Node(
        id="advisor",
        agent="pair-programmer",
        node_type=NodeType.AGENT,
        config={
            "skill_binding": {
                "persona_path": "hive/agents/pair-programmer.md",
                "trigger": "running observe",
            }
        },
    )
    spawn = StubAgentSpawn(
        canned_outputs={
            "advisor": {
                "advice": "Consider an additional boundary test.",
                "change_verdict": "passed",
            }
        }
    )
    handler = AgentHandler(spawn=spawn, plugin_root=plugin)

    with pytest.raises(AgentHandlerError, match="observe/advisor output violates"):
        handler.handle(node, inputs={}, run_id="rid-observe")
