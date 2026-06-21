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

import json
import subprocess
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


class LocalAgentSpawn:
    """Default production AgentSpawn binding — wraps Step 7 of agent-spawn/SKILL.md.

    Dispatches via the local one-shot path (`claude --print`). This is the
    fallback binding; MulticaAgentSpawn (s4) is the swap-in sibling for
    Multica-routed runs.

    Risk #2 HIGH defense (mirrors AgentHandler contract):
      * `agent` is forwarded RAW. No pre-resolution; the agent-spawn chain
        handles persona resolution at runtime.
      * `step_file_content` is embedded VERBATIM in the prompt body. No
        paraphrasing, trimming, or summarisation.

    The agent is expected to respond with a JSON object whose keys match the
    node's declared OutputRef names. Markdown code fences (```json … ```) are
    stripped before parsing.
    """

    _DEFAULT_TIMEOUT_MS = 300_000

    def __init__(
        self,
        *,
        timeout_ms: int = _DEFAULT_TIMEOUT_MS,
        claude_bin: str = "claude",
    ) -> None:
        self._timeout_ms = timeout_ms
        self._claude_bin = claude_bin

    # ------------------------------------------------------------------
    # AgentSpawn Protocol
    # ------------------------------------------------------------------

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        prompt = self.build_prompt(agent, step_file_content, inputs, run_id, step_id)
        raw = self._invoke_claude(prompt, step_id)
        return self._parse_json_output(raw, step_id)

    # ------------------------------------------------------------------
    # Prompt construction (exposed for testability)
    # ------------------------------------------------------------------

    def build_prompt(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> str:
        """Build the one-shot prompt passed to `claude --print`.

        step_file_content is embedded verbatim — no transformation.
        agent is the raw persona string — no pre-resolution.
        """
        parts: list[str] = [
            f"# Agent: {agent}",
            f"run_id: {run_id}  step_id: {step_id}",
        ]
        if inputs:
            parts.append(
                "## Inputs\n```json\n" + json.dumps(inputs, indent=2) + "\n```"
            )
        if step_file_content:
            parts.append("## Task\n" + step_file_content)
        parts.append(
            "## Output format\n"
            "Respond with a JSON object whose keys are the declared output names "
            "for this step. Output ONLY the JSON object — no preamble, no prose."
        )
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # Subprocess dispatch
    # ------------------------------------------------------------------

    def _invoke_claude(self, prompt: str, step_id: str) -> str:
        timeout_s = self._timeout_ms / 1000.0
        try:
            result = subprocess.run(
                [self._claude_bin, "--print"],
                input=prompt,
                text=True,
                capture_output=True,
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired as exc:
            raise AgentHandlerError(
                f"local agent-spawn timed out after {self._timeout_ms} ms "
                f"for step {step_id!r}"
            ) from exc
        if result.returncode != 0:
            raise AgentHandlerError(
                f"claude --print exited {result.returncode} for step {step_id!r}: "
                f"{result.stderr.strip()}"
            )
        return result.stdout

    # ------------------------------------------------------------------
    # Output parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_json_output(raw: str, step_id: str) -> dict[str, Any]:
        text = raw.strip()
        # Strip markdown code fences (```json … ``` or ``` … ```)
        if text.startswith("```"):
            lines = text.splitlines()
            end = len(lines)
            for i in range(1, len(lines)):
                if lines[i].strip() == "```":
                    end = i
                    break
            text = "\n".join(lines[1:end]).strip()
        try:
            result = json.loads(text)
        except ValueError as exc:
            raise AgentHandlerError(
                f"local agent-spawn for step {step_id!r} returned non-JSON: "
                f"{text[:200]!r}"
            ) from exc
        if not isinstance(result, dict):
            raise AgentHandlerError(
                f"local agent-spawn for step {step_id!r} returned "
                f"non-dict JSON ({type(result).__name__})"
            )
        return result


class MulticaAgentSpawn:
    """Multica-routed AgentSpawn binding — s6-multica-spawn.

    Each call:
      1. Resolves (or reuses) a Multica tracker issue keyed on
         (run_id, step_id) for idempotency — never mints a duplicate on
         resume.
      2. Dispatches the issue to the named agent via cli.mjs dispatch.
      3. Polls to terminal via cli.mjs poll.
      4. Raises AgentHandlerError on non-completed terminal status.
      5. Returns a dict with code_push_sha + work_dir (and ancillary ids).

    Python→Node bridge: shells hive/lib/multica-story-dispatch/cli.mjs
    subcommands and parses their JSON stdout.
    """

    _DEFAULT_TIMEOUT_MS = 3_600_000
    _FAST_CMD_TIMEOUT_S = 120.0

    def __init__(
        self,
        *,
        cli_path: str | Path | None = None,
        repo_root: Path | str | None = None,
        timeout_ms: int = _DEFAULT_TIMEOUT_MS,
        node_bin: str = "node",
    ) -> None:
        self._cli_path = Path(cli_path) if cli_path else self._default_cli_path()
        self._repo_root = (
            Path(repo_root).resolve() if repo_root else Path.cwd().resolve()
        )
        self._timeout_ms = timeout_ms
        self._node_bin = node_bin

    @staticmethod
    def _default_cli_path() -> Path:
        # agent.py is at hive/lib/dag_executor/executor/handlers/agent.py
        # cli.mjs  is at hive/lib/multica-story-dispatch/cli.mjs
        # handlers/ → ../../.. → hive/lib/
        here = Path(__file__).resolve().parent
        return (here / "../../../multica-story-dispatch/cli.mjs").resolve()

    # ------------------------------------------------------------------
    # AgentSpawn Protocol
    # ------------------------------------------------------------------

    def __call__(
        self,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        tracker_id = self._resolve_tracker_id(
            run_id, step_id, agent, step_file_content
        )
        self._dispatch(tracker_id, agent)
        terminal = self._poll(tracker_id)
        status = terminal.get("status", "")
        if status != "completed":
            raise AgentHandlerError(
                f"multica task {tracker_id!r} for step {step_id!r} "
                f"terminal with status {status!r}: {terminal.get('notes', '')}"
            )
        return {
            "code_push_sha": terminal.get("code_push_sha"),
            "work_dir": terminal.get("work_dir"),
            "task_id": terminal.get("task_id"),
            "agent_id": terminal.get("agent_id"),
            "tracker_id": tracker_id,
        }

    # ------------------------------------------------------------------
    # Idempotency
    # ------------------------------------------------------------------

    def _tracker_state_path(self, run_id: str, step_id: str) -> Path:
        return (
            self._repo_root
            / ".pHive"
            / "dag-spawn-state"
            / run_id
            / step_id
            / "tracker.json"
        )

    def _resolve_tracker_id(
        self,
        run_id: str,
        step_id: str,
        agent: str,
        step_file_content: str,
    ) -> str:
        state_path = self._tracker_state_path(run_id, step_id)
        if state_path.exists():
            try:
                data = json.loads(state_path.read_text(encoding="utf-8"))
                existing = data.get("tracker_id")
                if existing:
                    return str(existing)
            except (ValueError, OSError):
                pass

        title = f"[dag:{run_id}:{step_id}] {agent}"
        # cli.mjs requires non-empty --body; use a placeholder when no step_file
        # was provided (step_file_content is ""). This does NOT violate the VERBATIM
        # rule — verbatim means no paraphrasing of non-empty content.
        body = step_file_content or f"(no step_file provided — run {run_id} step {step_id})"
        result = self._run_cli_fast(
            ["create-issue", "--title", title, "--body", body]
        )
        tracker_id = result.get("id")
        if not tracker_id:
            raise AgentHandlerError(
                f"multica create-issue returned no id for step {step_id!r}: {result!r}"
            )
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(
            json.dumps(
                {"tracker_id": tracker_id, "run_id": run_id, "step_id": step_id}
            ),
            encoding="utf-8",
        )
        return str(tracker_id)

    # ------------------------------------------------------------------
    # CLI dispatch + poll
    # ------------------------------------------------------------------

    def _dispatch(self, tracker_id: str, agent: str) -> None:
        self._run_cli_fast(
            ["dispatch", "--issue", tracker_id, "--agent", agent]
        )

    def _poll(self, tracker_id: str) -> dict[str, Any]:
        poll_timeout_s = self._timeout_ms / 1000.0 + 120.0
        return self._run_cli(
            ["poll", "--issue", tracker_id, "--timeout-ms", str(self._timeout_ms)],
            timeout_s=poll_timeout_s,
        )

    def _run_cli_fast(self, args: list[str]) -> dict[str, Any]:
        return self._run_cli(args, timeout_s=self._FAST_CMD_TIMEOUT_S)

    def _run_cli(self, args: list[str], *, timeout_s: float) -> dict[str, Any]:
        cmd = [self._node_bin, str(self._cli_path)] + args
        try:
            result = subprocess.run(
                cmd,
                text=True,
                capture_output=True,
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired as exc:
            raise AgentHandlerError(
                f"cli.mjs {args[0]!r} process timed out after {timeout_s:.0f}s"
            ) from exc
        if result.returncode != 0:
            raise AgentHandlerError(
                f"cli.mjs {args[0]!r} exited {result.returncode}: "
                f"{result.stderr.strip()}"
            )
        try:
            data = json.loads(result.stdout)
        except ValueError as exc:
            raise AgentHandlerError(
                f"cli.mjs {args[0]!r} returned non-JSON: {result.stdout[:200]!r}"
            ) from exc
        if not isinstance(data, dict):
            raise AgentHandlerError(
                f"cli.mjs {args[0]!r} returned non-dict ({type(data).__name__})"
            )
        return data


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
