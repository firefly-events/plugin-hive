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


# Spawn-supplied metadata keys (commit/task bookkeeping derived from the agent's
# git HEAD + Multica task record) — present even when the agent produced no real
# work, so they are EXCLUDED from the #22 under-run check, which looks only at a
# node's declared SEMANTIC outputs.
_SPAWN_METADATA_OUTPUTS = frozenset(
    {
        "code_push_sha",
        "commit_sha",
        "branch",
        "repo",
        "work_dir",
        "task_id",
        "agent_id",
        "tracker_id",
    }
)


def _output_is_empty(value: Any) -> bool:
    """True when a harvested output carries no real value (None / empty
    string / empty collection). ``False`` (a real bool) is NOT empty."""
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


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
            run_id, step_id, agent, step_file_content, inputs
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
        # #13: the GENERAL output channel. Multica agents emit a node's declared
        # SEMANTIC outputs (booleans/strings/paths like ``needs_frontend``,
        # ``test_artifacts``, ``implementation`` — values, not files) by writing
        # ``.pHive/dag-outputs/outputs.yaml`` in their isolated work_dir. Read it
        # and merge (authoritative — declared outputs override file-inference).
        # This supersedes the plan-specific docs harvest below for any node that
        # writes the file; the docs harvest stays as a fallback.
        for key, value in self._harvest_node_outputs(terminal.get("work_dir")).items():
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
    def _find_repo_checkout(work_dir: str | None) -> Path | None:
        """The dir holding the agent's planning artifacts inside its work_dir.

        Prefer a git checkout (the work_dir itself or a single repo subdir under
        it). But Multica does not always materialise a checkout for every node —
        a design/research task can run with the repo absent, in which case the
        agent writes ``.pHive/epics/...`` directly under the work_dir root (no
        ``.git``). Fall back to whichever dir actually contains ``.pHive/epics``
        so the git-less worktree scan in ``_harvest_artifacts`` can still surface
        the brief/discussion. ``None`` if nothing is found.
        """
        if not work_dir:
            return None
        wd = Path(work_dir)
        try:
            children = sorted(p for p in wd.iterdir() if p.is_dir())
            # 1. git checkout — preferred (enables committed-path scoping)
            if (wd / ".git").exists():
                return wd
            for child in children:
                if (child / ".git").exists():
                    return child
            # 2. no checkout — locate the dir that holds the written artifacts
            if (wd / ".pHive" / "epics").is_dir():
                return wd
            for child in children:
                if (child / ".pHive" / "epics").is_dir():
                    return child
        except OSError:
            return None
        return None

    @staticmethod
    def _committed_phive_paths(repo_dir: Path) -> list[str] | None:
        """Repo-relative ``.pHive/epics/...`` paths the agent ADDED/changed on
        its branch versus the base branch — i.e. THIS run's output, not epics
        that already existed in a consumer project's repo (#1 review fix).

        Returns ``None`` when git or a base ref can't be resolved, so the caller
        can fall back to a worktree scan.
        """

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
            return result.stdout.strip() if result.returncode == 0 else None

        base = None
        for ref in ("origin/HEAD", "origin/main", "main", "origin/master", "master"):
            if _git("rev-parse", "--verify", "--quiet", ref) is not None:
                base = ref
                break
        if base is None:
            return None
        merge_base = _git("merge-base", base, "HEAD")
        if not merge_base:
            return None
        diff = _git("diff", "--name-only", "--diff-filter=ACMR", merge_base, "HEAD")
        if diff is None:
            return None
        return [
            line for line in diff.splitlines() if line.startswith(".pHive/epics/")
        ]

    @staticmethod
    def _uncommitted_phive_paths(repo_dir: Path) -> list[str]:
        """Repo-relative ``.pHive/epics/...`` paths the agent WROTE but did not
        commit (untracked or modified). Plan research/design agents write the
        brief/discussion file but the author node is the one that commits — so
        under the Multica binding the intermediate artifact lives only in the
        producing agent's worktree, uncommitted. ``_committed_phive_paths``
        returns ``[]`` (not ``None``) when the agent made no commit at all, which
        skips the worktree fallback; this captures that case precisely without
        over-scoping a consumer repo's pre-existing COMMITTED epics. Empty on any
        git failure.
        """
        try:
            result = subprocess.run(
                [
                    "git",
                    "-C",
                    str(repo_dir),
                    "status",
                    "--porcelain",
                    "--untracked-files=all",  # list files, not collapsed dirs
                    "--",
                    ".pHive/epics",
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError):
            return []
        if result.returncode != 0:
            return []
        paths: list[str] = []
        for line in result.stdout.splitlines():
            # porcelain v1: 2 status chars + space + path (renames use ` -> `)
            rel = line[3:].strip() if len(line) > 3 else ""
            if " -> " in rel:
                rel = rel.split(" -> ", 1)[1]
            if rel.startswith(".pHive/epics/"):
                paths.append(rel)
        return paths

    @staticmethod
    def _harvest_node_outputs(work_dir: str | None) -> dict[str, Any]:
        """Read the node's declared SEMANTIC outputs that the agent wrote to
        ``.pHive/dag-outputs/outputs.yaml`` (or ``.json``) in its work_dir (#13).

        This is the general output channel for the Multica binding: an agent
        emits decision/value outputs (``needs_frontend: true``,
        ``test_artifacts: <path>``, ...) the graph's ``when:`` predicates and
        downstream input bindings consume — values that are NOT files and so are
        not captured by the plan docs harvest. The file lives in the ephemeral
        Multica work_dir and is gitignored, so it never enters the project repo.

        Best-effort: any parse/read error yields ``{}`` so it never masks a real
        task result.
        """
        out: dict[str, Any] = {}
        if not work_dir:
            return out
        wd = Path(work_dir)
        try:
            candidates = sorted(wd.glob("**/.pHive/dag-outputs/outputs.yaml")) + sorted(
                wd.glob("**/.pHive/dag-outputs/outputs.json")
            )
        except OSError:
            return out
        for path in candidates:
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            data: Any = None
            try:
                if path.suffix == ".json":
                    data = json.loads(text)
                else:
                    import yaml

                    data = yaml.safe_load(text)
            except (ValueError, Exception):  # noqa: BLE001 — best-effort parse
                continue
            if isinstance(data, dict):
                for key, value in data.items():
                    out[str(key)] = value
        return out

    @staticmethod
    def _harvest_artifacts(work_dir: str | None) -> dict[str, Any]:
        """Read the planning artifacts the agent committed in its work_dir and
        surface them as named outputs (file-stored, passed in-memory).

        - ``.pHive/epics/<id>/docs/<name>.md`` -> output ``<name>`` with hyphens
          converted to underscores so it matches the graph's ``output_name``
          (e.g. ``research-brief.md`` -> ``research_brief``).
        - ``.pHive/epics/<id>/epic.yaml`` -> output ``epic_dir`` set to the
          repo-relative epic directory (``.pHive/epics/<id>``).

        Scoped to the files THIS agent committed on its branch (vs the base), so
        a consumer repo's pre-existing ``.pHive/epics/*`` are NOT harvested as
        this run's output (#1 review fix). Best-effort: read errors are skipped.
        """
        out: dict[str, Any] = {}
        repo_dir = MulticaAgentSpawn._find_repo_checkout(work_dir)
        if repo_dir is None:
            return out

        rels = MulticaAgentSpawn._committed_phive_paths(repo_dir)
        if rels is None:
            # git/base unavailable — fall back to a worktree scan (correct for a
            # fresh single-epic repo; may over-scope a multi-epic consumer repo).
            try:
                rels = [
                    str(p.relative_to(repo_dir))
                    for p in repo_dir.glob(".pHive/epics/*/docs/*.md")
                ] + [
                    str(p.relative_to(repo_dir))
                    for p in repo_dir.glob(".pHive/epics/*/epic.yaml")
                ]
            except OSError:
                return out

        # Union in artifacts the agent wrote but did NOT commit (plan
        # research/design write the brief; only the author node commits). Without
        # this, a no-commit producer yields an empty committed-diff -> the
        # downstream ``research_brief`` edge resolves to nothing and the run
        # fails at the author node.
        rels = sorted(set(rels) | set(MulticaAgentSpawn._uncommitted_phive_paths(repo_dir)))

        for rel in sorted(rels):
            parts = Path(rel).parts
            if (
                len(parts) >= 5
                and parts[0] == ".pHive"
                and parts[1] == "epics"
                and parts[3] == "docs"
                and rel.endswith(".md")
            ):
                try:
                    out[Path(rel).stem.replace("-", "_")] = (
                        repo_dir / rel
                    ).read_text(encoding="utf-8")
                except OSError:
                    continue
            elif (
                len(parts) == 4
                and parts[0] == ".pHive"
                and parts[1] == "epics"
                and parts[3] == "epic.yaml"
            ):
                out.setdefault(
                    "epic_dir", str(Path(parts[0], parts[1], parts[2]))
                )
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
        repo_dir = MulticaAgentSpawn._find_repo_checkout(work_dir)
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

    def _branch_contract(self) -> str:
        """Brief preamble telling the agent to base its work on the executor's
        target branch (#15), when ``repo_root`` is on a non-default (epic)
        branch. Empty on the default branch (e.g. plan, which creates its own
        epic branch) — preserving that flow. Best-effort: returns "" if git
        can't resolve the branch.
        """
        if self._repo_root is None or not (self._repo_root / ".git").exists():
            # No git checkout (e.g. unit tests with a plain tmp repo_root) — skip
            # entirely so we don't issue subprocess calls a test's mock expects
            # to be cli.mjs invocations.
            return ""

        def _git(*args: str) -> str | None:
            try:
                result = subprocess.run(
                    ["git", "-C", str(self._repo_root), *args],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
            except (OSError, subprocess.SubprocessError):
                return None
            return result.stdout.strip() if result.returncode == 0 else None

        branch = _git("rev-parse", "--abbrev-ref", "HEAD")
        if not branch or branch == "HEAD":
            return ""
        default = None
        head = _git("rev-parse", "--abbrev-ref", "origin/HEAD")
        if head and "/" in head:
            default = head.split("/", 1)[1]
        if default is None:
            for cand in ("main", "master", "develop"):
                if _git("rev-parse", "--verify", "--quiet", f"origin/{cand}") is not None:
                    default = cand
                    break
        if branch == default:
            return ""  # default branch — no epic-branch directive
        return (
            "## Repo branch contract — FIRST ACTION (overrides the daemon's auto-checkout)\n\n"
            f"The DAG executor reconciles your commit FROM the `{branch}` branch (the epic "
            "branch). The Multica daemon auto-checks-out the repo's default branch; you must "
            f"move to `{branch}` before doing any work:\n\n"
            "```bash\n"
            f"git fetch origin {branch}\n"
            f"git checkout {branch} 2>/dev/null || git checkout -b {branch} origin/{branch}\n"
            "```\n\n"
            f"Do ALL work and commits on `{branch}`. Do NOT commit on the daemon's "
            "auto-created `agent/<persona>/<task>` branch — commits there will not reconcile "
            "into the run."
        )

    def _resolve_tracker_id(
        self,
        run_id: str,
        step_id: str,
        agent: str,
        step_file_content: str,
        inputs: dict[str, Any] | None = None,
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
        # #12: the issue body IS the agent's brief. It must carry the node's
        # `inputs` — the requirement and upstream outputs (research_brief,
        # design_discussion, ...) — not just the step_file. Without them the
        # Multica agent has no requirement and can only improvise from the repo.
        # Mirror LocalAgentSpawn.build_prompt: inputs as a JSON block + the
        # verbatim step_file. (Dedup is on the title, so a richer body is safe.)
        body_parts: list[str] = []
        # #15: when repo_root is on a non-default (epic) branch, the executor
        # reconciles the agent's commit FROM that branch. The Multica daemon
        # auto-checks-out the repo's DEFAULT branch (main) and creates an
        # agent/<persona>/<task> branch off it, so the agent's commit diverges
        # from the epic branch and reconcile (ff-only) fails. Inject a branch
        # contract telling the agent to base its work on the target branch
        # (mirrors the proven multica-story-dispatch Integration Contract). On
        # the default branch (e.g. plan, which CREATES its own epic branch) this
        # is empty, preserving that flow.
        contract = self._branch_contract()
        if contract:
            body_parts.append(contract)
        if inputs:
            body_parts.append(
                "## Inputs\n```json\n" + json.dumps(inputs, indent=2) + "\n```"
            )
        if step_file_content:
            body_parts.append("## Task\n" + step_file_content)
        # cli.mjs requires non-empty --body; use a placeholder when both are empty.
        body = "\n\n".join(body_parts) or (
            f"(no step_file provided — run {run_id} step {step_id})"
        )

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


def default_plugin_root() -> Path:
    """The plugin install root, derived from this module's location
    (``<plugin>/hive/lib/dag_executor/executor/handlers/agent.py``). Production
    wiring (``assemble_dispatcher``) passes this into ``AgentHandler`` so
    plugin-shipped step_files resolve for a consumer project. Kept out of the
    handler's default so rootless/repo_root-only callers keep legacy behavior.
    """
    return Path(__file__).resolve().parents[5]


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
        # When ``plugin_root`` is supplied (production wires it via
        # ``assemble_dispatcher`` -> ``default_plugin_root()``), step_files
        # resolve against it first, with ``repo_root`` as a fallback.
        #
        # It is NOT defaulted here on purpose: a rootless caller (no repo_root,
        # no plugin_root — e.g. a test passing an absolute step_file) must keep
        # the legacy "read the path as given" behavior, and a repo_root-only
        # caller must keep the original absolute-escapes-repo_root guard. An
        # always-on plugin_root would break both.
        self._plugin_root = (
            Path(plugin_root).resolve() if plugin_root is not None else None
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

        # #22: under-run guard with built-in re-dispatch (Multica binding only).
        # A Multica agent can report 'completed' yet end its session without
        # producing its work (it does the bootstrap 'multica issue get' but its
        # turn ends before writing outputs.yaml / committing). The spawn still
        # returns commit/task METADATA from git HEAD, so the run would otherwise
        # limp on and fail a downstream node with a confusing "input X was not
        # produced". An under-run is transient — a fresh agent run usually
        # produces the work — so re-dispatch a bounded number of times here
        # (covers ALL Multica agent nodes; no per-node `retry:` needed). Scoped to
        # MulticaAgentSpawn: local/test spawns return canned/explicit outputs and
        # an empty one is intentional. (NOT keyed off the forced_stop interrupt
        # marker, which is written on every Stop event and is not a failure
        # signal.)
        is_multica = isinstance(self._spawn, MulticaAgentSpawn)
        semantic_outputs = [
            getattr(o, "name", None)
            for o in (getattr(node, "outputs", None) or [])
            if getattr(o, "name", None)
            and getattr(o, "name", None) not in _SPAWN_METADATA_OUTPUTS
        ]
        max_under_run_attempts = 3 if (is_multica and semantic_outputs) else 1

        outputs: dict[str, Any] = {}
        for attempt in range(1, max_under_run_attempts + 1):
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

            under_run = bool(semantic_outputs) and all(
                _output_is_empty(outputs.get(n)) for n in semantic_outputs
            )
            if not (is_multica and under_run):
                break
            if attempt >= max_under_run_attempts:
                raise AgentHandlerError(
                    f"node {node.id!r}: agent reported completed but produced none "
                    f"of its declared outputs {semantic_outputs} after "
                    f"{max_under_run_attempts} attempts (under-run)"
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
