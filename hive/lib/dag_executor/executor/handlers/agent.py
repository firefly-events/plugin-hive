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
        outputs = {
            "code_push_sha": terminal.get("code_push_sha"),
            # commit_sha is the graph-canonical alias for code_push_sha so
            # reconcile nodes can bind output_name: commit_sha without a
            # name-mismatch silent no-op (C1 fix).
            "commit_sha": terminal.get("code_push_sha"),
            "branch": terminal.get("branch"),
            "repo": terminal.get("repo"),
            "work_dir": terminal.get("work_dir"),
            "task_id": terminal.get("task_id"),
            "agent_id": terminal.get("agent_id"),
            "tracker_id": tracker_id,
        }
        # #7: Multica's task API does NOT report the agent's commit/push, so the
        # poll terminal carries no code_push_sha/branch/repo — leaving the
        # reconcile node with nothing to ff-merge (the committed epic never
        # reaches the gate's repo_root). Derive the real commit metadata from
        # the git HEAD of the agent's isolated work_dir checkout, and point
        # reconcile at that local checkout as the fetch source (no dependency on
        # the agent having pushed to a remote).
        for key, value in self._harvest_git_state(terminal.get("work_dir")).items():
            if value is not None:
                outputs[key] = value
        # Surface the agent's committed planning artifacts as named outputs so
        # downstream nodes can consume them in-memory. Multica agents deliver
        # research/design/plan artifacts as FILES committed in their isolated
        # work_dir (e.g. .pHive/epics/<id>/docs/research-brief.md), not as
        # in-graph outputs. Without this, a graph edge like
        # ``author.research_brief <- research.research_brief`` resolves to
        # nothing and the run fails (the binding otherwise returns only commit
        # metadata). Harvest the files and key them so they match the graph's
        # declared output names.
        for key, value in self._harvest_artifacts(terminal.get("work_dir")).items():
            outputs.setdefault(key, value)
        return outputs

    @staticmethod
    def _harvest_artifacts(work_dir: str | None) -> dict[str, Any]:
        """Read the planning artifacts the agent committed in its work_dir and
        surface them as named outputs (file-stored, passed in-memory).

        - ``.pHive/epics/<id>/docs/<name>.md`` -> output ``<name>`` with hyphens
          converted to underscores so it matches the graph's ``output_name``
          (e.g. ``research-brief.md`` -> ``research_brief``).
        - ``.pHive/epics/<id>/epic.yaml`` -> output ``epic_dir`` set to the
          repo-relative epic directory (``.pHive/epics/<id>``).

        Best-effort: read errors are skipped so harvesting never masks a real
        task result.
        """
        out: dict[str, Any] = {}
        if not work_dir:
            return out
        wd = Path(work_dir)
        try:
            for md in sorted(wd.glob("**/.pHive/epics/*/docs/*.md")):
                try:
                    out[md.stem.replace("-", "_")] = md.read_text(encoding="utf-8")
                except OSError:
                    continue
            for epic_yaml in sorted(wd.glob("**/.pHive/epics/*/epic.yaml")):
                epic_dir = epic_yaml.parent
                repo_root = epic_dir.parents[2]  # parent of the `.pHive` dir
                out["epic_dir"] = str(epic_dir.relative_to(repo_root))
                break
        except OSError:
            pass
        return out

    @staticmethod
    def _harvest_git_state(work_dir: str | None) -> dict[str, Any]:
        """Derive the agent's commit metadata from the git HEAD of its work_dir
        checkout (#7).

        Multica's task API does not report what the agent committed/pushed, so
        the poll terminal has no sha/branch/repo. The agent's isolated work_dir
        IS a real git checkout sitting on the branch + commit it produced, so we
        read it directly:

        - ``code_push_sha`` / ``commit_sha`` <- ``git rev-parse HEAD``
        - ``branch`` <- ``git rev-parse --abbrev-ref HEAD``
        - ``repo`` / ``work_dir`` <- the checkout path, so the reconcile node
          fetches the branch from this LOCAL checkout (no remote-push
          dependency; reconcileBranch accepts a local repo path).

        Best-effort: returns ``{}`` if no checkout/git is found so it never
        masks a real task result.
        """
        out: dict[str, Any] = {}
        if not work_dir:
            return out
        wd = Path(work_dir)
        repo_dir: Path | None = None
        try:
            if (wd / ".git").exists():
                repo_dir = wd
            else:
                for child in sorted(p for p in wd.iterdir() if p.is_dir()):
                    if (child / ".git").exists():
                        repo_dir = child
                        break
        except OSError:
            return out
        if repo_dir is None:
            return out

        def _git(*args: str) -> str | None:
            try:
                result = subprocess.run(
                    ["git", "-C", str(repo_dir), *args],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            except (OSError, subprocess.SubprocessError):
                return None
            if result.returncode != 0:
                return None
            return result.stdout.strip() or None

        sha = _git("rev-parse", "HEAD")
        branch = _git("rev-parse", "--abbrev-ref", "HEAD")
        if sha:
            out["code_push_sha"] = sha
            out["commit_sha"] = sha
        if branch and branch != "HEAD":
            out["branch"] = branch
        out["repo"] = str(repo_dir)
        out["work_dir"] = str(repo_dir)
        return out

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
        """Resolve (or create-and-cache) the Multica tracker issue id for this step.

        Idempotency is layered:
        - Primary: server-side title dedup via ``--dedup-title`` (durable, cross-machine).
        - Secondary: local ``tracker.json`` cache for fast-path resume without a list call.
        - Belt-and-suspenders (H1): intent marker written before the network call so a
          same-machine crash between create-issue success and state write leaves a trace.
        """
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

        # Write intent marker BEFORE the network call (H1 belt-and-suspenders).
        # If the process dies after create-issue returns but before the state write,
        # this marker ensures resume finds a file and re-attempts with server dedup.
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(
            json.dumps({"run_id": run_id, "step_id": step_id}),
            encoding="utf-8",
        )

        # --dedup-title makes the Multica server the authoritative idempotency source:
        # cli.mjs lists existing issues and returns the matching one instead of creating
        # a duplicate. This is the primary guard for cross-machine resume (H2).
        result = self._run_cli_fast(
            ["create-issue", "--title", title, "--body", body, "--dedup-title", title]
        )
        tracker_id = result.get("id")
        if not tracker_id:
            raise AgentHandlerError(
                f"multica create-issue returned no id for step {step_id!r}: {result!r}"
            )

        # Overwrite intent marker with resolved tracker_id (fast-path cache).
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
        plugin_root: Path | str | None = None,
    ) -> None:
        self._spawn = spawn
        self._repo_root = Path(repo_root) if repo_root is not None else None
        # step_files are plugin-shipped content (e.g.
        # ``hive/workflows/step-files/plan/research.md``) installed WITH the
        # plugin — they do NOT live inside a consumer project's ``repo_root``.
        # Resolve them against the plugin root by default (derived from this
        # module's install location); ``repo_root`` remains a fallback so
        # project-local workflow step_files still resolve.
        self._plugin_root = (
            Path(plugin_root).resolve()
            if plugin_root is not None
            else Path(__file__).resolve().parents[5]
        )

    def _read_step_file(self, step_file: str) -> str:
        """Read the step_file's content verbatim. No transformation.

        ``step_file`` paths in plugin workflows are relative to the plugin
        root (where the workflow graph and step-files ship). Resolve against
        the plugin root first, then fall back to ``repo_root`` for
        project-local workflows. In every case the resolved path MUST stay
        inside the root it matched — ``..`` segments and absolute paths that
        escape every allowed root are rejected so a malformed or
        attacker-controlled workflow cannot inject arbitrary file content.
        """
        path = Path(step_file)
        roots: list[Path] = []
        if self._plugin_root is not None:
            roots.append(self._plugin_root.resolve())
        if self._repo_root is not None:
            roots.append(self._repo_root.resolve())

        last_not_found: Exception | None = None
        for root in roots:
            candidate = (
                path if path.is_absolute() else (root / path)
            ).resolve()
            try:
                candidate.relative_to(root)
            except ValueError:
                continue  # escapes this root — try the next allowed root
            try:
                return candidate.read_text(encoding="utf-8")
            except FileNotFoundError as exc:
                last_not_found = exc
                continue  # not under this root — try the next
            except OSError as exc:
                raise AgentHandlerError(
                    f"failed to read step_file {step_file}: {exc}"
                ) from exc

        if not roots:
            # No configured root — legacy as-given resolution.
            try:
                return path.read_text(encoding="utf-8")
            except FileNotFoundError as exc:
                raise AgentHandlerError(
                    f"step_file not found: {step_file}"
                ) from exc
            except OSError as exc:
                raise AgentHandlerError(
                    f"failed to read step_file {step_file}: {exc}"
                ) from exc

        raise AgentHandlerError(
            f"step_file not found: {step_file}"
        ) from last_not_found

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
