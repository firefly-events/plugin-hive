"""Agent handler — invokes the existing agent-spawn skill chain UNCHANGED.

Risk #2 HIGH defense:
  * `node.agent` is passed RAW. Generic `developer` STAYS `developer`;
    resolution to `frontend-developer` / `backend-developer` happens
    inside the agent-spawn chain at runtime (team-lead's job).
  * `node.step_file` content is read VERBATIM into the prompt. No
    paraphrasing, no summarisation, no transformation.
  * The handler does NOT pre-resolve, inline, or re-implement any part
    of `skills/hive/skills/agent-spawn/SKILL.md`. It builds a prompt
    payload and passes it to the spawn callable.

The spawn callable is injected. In production it points at the
agent-spawn dispatch (Step 7 of the skill). In tests it points at a
spy that records the exact invocation shape (asserted by
`test_handlers_agent.py`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from ..errors import AgentHandlerError


@dataclass
class NodeOutput:
    """Materialised outputs from a single node, keyed by output name.

    `outputs` mirrors the OutputRef.name fields declared on the node.
    `meta` carries handler-specific bookkeeping (return code, raw
    stdout, spawn surface_id, ...) that downstream nodes typically
    ignore.
    """

    outputs: dict[str, Any] = field(default_factory=dict)
    meta: dict[str, Any] = field(default_factory=dict)


class AgentSpawn(Protocol):
    """Callable shape the agent-spawn dispatch must satisfy.

    The production binding wraps Step 7 of `agent-spawn/SKILL.md`. The
    test binding records calls so the spy can assert raw `developer`
    string + verbatim step_file content + run_id propagation.
    """

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:  # pragma: no cover — Protocol
        ...


class StubAgentSpawn:
    """Deterministic spawn used by the spine parity test and fixtures.

    Returns canned outputs keyed by `step_id`. Records every invocation
    in `self.calls` so unit tests can spy on the call shape.
    """

    def __init__(self, canned_outputs: dict[str, dict[str, Any]] | None = None):
        self.canned_outputs = canned_outputs or {}
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "agent": agent,
                "step_file_content": step_file_content,
                "inputs": dict(inputs),
                "run_id": run_id,
                "step_id": step_id,
            }
        )
        return dict(self.canned_outputs.get(step_id, {}))


class AgentHandler:
    """Dispatches agent nodes through the agent-spawn chain unchanged."""

    def __init__(
        self,
        spawn: AgentSpawn,
        repo_root: Path | str | None = None,
    ) -> None:
        self._spawn = spawn
        self._repo_root = Path(repo_root) if repo_root is not None else None

    def _read_step_file(self, step_file: str) -> str:
        """Read the step_file's content verbatim. No transformation.

        When ``repo_root`` is configured, ``step_file`` MUST resolve inside
        that root. ``..`` segments and absolute paths that escape the root
        are rejected up-front so an attacker-controlled or malformed
        workflow cannot inject arbitrary file content into agent input.
        """
        path = Path(step_file)
        if self._repo_root is not None:
            root = self._repo_root.resolve()
            candidate = (
                path if path.is_absolute() else (root / path)
            ).resolve()
            try:
                candidate.relative_to(root)
            except ValueError as exc:
                raise AgentHandlerError(
                    f"step_file escapes repo_root: {step_file}"
                ) from exc
            path = candidate
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError as exc:
            raise AgentHandlerError(f"step_file not found: {step_file}") from exc
        except OSError as exc:
            raise AgentHandlerError(
                f"failed to read step_file {step_file}: {exc}"
            ) from exc

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        if not isinstance(node.agent, str) or not node.agent:
            raise AgentHandlerError(
                f"node {node.id!r} has no agent string for AgentHandler"
            )

        step_file_content = ""
        if node.step_file:
            step_file_content = self._read_step_file(node.step_file)

        try:
            outputs = self._spawn(
                agent=node.agent,
                step_file_content=step_file_content,
                inputs=dict(inputs),
                run_id=run_id,
                step_id=node.id,
            )
        except AgentHandlerError:
            raise
        except Exception as exc:  # pragma: no cover — exercised in tests
            raise AgentHandlerError(
                f"agent-spawn dispatch failed for node {node.id!r}: {exc}"
            ) from exc

        if not isinstance(outputs, dict):
            raise AgentHandlerError(
                f"agent-spawn returned non-dict outputs for node {node.id!r}"
            )

        # hde-4 Risk #9 guard: when this node ran in a parallel branch
        # context, two siblings could both want to write the SAME
        # `.pHive/insights/{epic_id}/{story_id}/<slug>.md` path. We
        # disambiguate the slug deterministically here — first 8 chars
        # of run_id are appended — so the actual write (performed by
        # the agent-spawn chain or a later promotion step) lands on a
        # unique path. Only triggered when the spawn explicitly
        # surfaces an `insight_slug` and the caller passes epic_id +
        # story_id via inputs; otherwise the outputs round-trip
        # untouched.
        insight_slug = outputs.get("insight_slug")
        epic_id = inputs.get("epic_id")
        story_id = inputs.get("story_id")
        if (
            isinstance(insight_slug, str)
            and insight_slug
            and isinstance(epic_id, str)
            and epic_id
            and isinstance(story_id, str)
            and story_id
        ):
            from hive.lib.dag_executor.routing import disambiguate_insight_slug

            outputs = dict(outputs)
            outputs["insight_slug"] = disambiguate_insight_slug(
                epic_id=epic_id,
                story_id=story_id,
                slug=insight_slug,
                run_id=run_id,
            )

        return NodeOutput(outputs=outputs)
