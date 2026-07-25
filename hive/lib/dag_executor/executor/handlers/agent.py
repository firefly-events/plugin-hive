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
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Protocol

from ..errors import AgentHandlerError, FatalAgentHandlerError
from hive.lib.skill_binding import SkillBindingError, build_skill_injection, resolve_skill_binding
from hive.lib.observe_contract import validate_observe_output


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


def _story_spec_is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (dict, list, tuple, set)):
        return not value
    return False

# A Multica task can become terminal just before its worktree flush completes.
# Re-read that SAME worktree on a short bounded schedule before spending a new
# dispatch attempt (which would create a different worktree and can strand the
# late outputs). The first pass is immediate; total wait is 7.75 seconds.
_REHARVEST_DELAYS_S = (0.0, 0.25, 0.5, 1.0, 2.0, 4.0)
_REMOTE_LOOKUP_DELAYS_S = (0.0, 0.25, 0.5, 1.0, 2.0, 4.0)


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


# s3-persist-review-findings: the reviewer's REAL findings live in a stable
# report file, not just the terse ``review_findings`` scalar in outputs.yaml.
# A path-only or blank scalar previously satisfied output completeness even
# when the report it named was empty (#observed on E1 s2 r3) — a blocked
# story then had no auditable findings surface. The report is validated
# content, not merely a truthy path string.
_REVIEW_REPORT_GLOB = "**/.pHive/dag-outputs/review-report.md"


def _is_valid_review_report(text: str) -> bool:
    """Minimal structural check: non-blank, and names a verdict and the
    reviewed SHA so a blocked story has something auditable to read."""
    if not text or not text.strip():
        return False
    line_prefix = r"(?im)^\s*(?:[-*]\s+)?(?:#{1,6}\s+)?"
    verdict_key = re.search(
        line_prefix + r"(?:\*\*)?verdict(?:(?:\*\*)?\s*:|:\s*(?:\*\*)?)",
        text,
    )
    sha_key = re.search(
        line_prefix
        + r"(?:\*\*)?(?:(?:reviewed|commit)\s+)?sha"
        + r"(?:(?:\*\*)?\s*:|:\s*(?:\*\*)?)",
        text,
    )
    return verdict_key is not None and sha_key is not None


def _output_contract_preamble(output_names: list[str]) -> str:
    """A hard, agent-facing instruction prepended to a Multica node's brief so a
    flaky agent turn cannot silently end without emitting the node's declared
    outputs.

    The #22 under-run failures were intermittent and difficulty-independent: the
    agent finished its turn (any node, any story — even a trivial preflight)
    without writing ``.pHive/dag-outputs/outputs.yaml`` (#13), so the harvest came
    back empty and the node failed. Re-dispatching a fresh agent re-rolled the
    same dice. Naming the exact required keys up front and gating "your turn is
    not done until they exist" converts a forgotten write into an explicit,
    checkable obligation the agent must satisfy before stopping.
    """
    keys = ", ".join(f"`{n}`" for n in output_names)
    return (
        "## OUTPUT CONTRACT (#13 — MANDATORY)\n\n"
        "Before you end your turn you MUST write the file "
        "`.pHive/dag-outputs/outputs.yaml` in your work_dir. It MUST be valid "
        f"YAML and MUST contain these top-level keys: {keys}. Each value is the "
        "real result this node produced (a path, sha, boolean, or short string "
        "— never a placeholder). If that file is missing, or is missing any of "
        "those keys, your work is INCOMPLETE and will be DISCARDED — do not stop "
        "until it exists with every key.\n\n"
        "---\n\n"
    )


def _output_contract_closer(output_names: list[str]) -> str:
    """A terminal restatement of the #13 output contract, appended as the LAST
    thing in a Multica node's brief.

    The prepended preamble alone left a gap: an agent reads it up front, works a
    long task, and ends its turn without writing ``outputs.yaml`` — the write was
    most due exactly when the instruction was least fresh (observed on the test
    node, which ran dev-supplied passing tests and stopped without emitting
    ``test_results``/``test_artifacts``). Restating the obligation at the stop
    boundary closes that gap; it is cheap, additive, and applies to every node
    that declares semantic outputs.
    """
    keys = ", ".join(f"`{n}`" for n in output_names)
    return (
        "\n\n---\n\n"
        "## ⛔ STOP GATE (#13 — DO THIS LAST, BEFORE YOU END YOUR TURN)\n\n"
        f"Your turn is NOT complete until `.pHive/dag-outputs/outputs.yaml` exists "
        f"in your work_dir with EVERY key: {keys}. Writing your work report or "
        "committing code is NOT a substitute. Self-check now: does that file exist "
        "with every key set to a real value (not a placeholder)? If not, write it "
        "and only then stop. A missing or partial file means your work is "
        "DISCARDED and the node fails.\n"
    )


def _rlm_opt_in(node: Any) -> bool:
    """The a-rlm-recursive-node opt-in gate — a MINIMAL, dependency-free check on
    ``node.config.rlm`` so the flag-OFF path decides WITHOUT importing rlm.py
    (codex finding 2).

    Activation (codex finding 3 — no truthiness footgun):
      * scalar ``rlm: true``  -> ON
      * block  ``rlm: {enabled: true, ...}`` -> ON (explicit ``enabled: true``)
      * ``rlm: false`` / ``rlm: {}`` / ``rlm: {enabled: false}`` / absent /
        non-dict config -> OFF

    An empty ``rlm: {}`` block therefore does NOT activate: the dict form REQUIRES
    an explicit ``enabled: true``.
    """
    config = getattr(node, "config", None)
    if not isinstance(config, dict):
        return False
    rlm = config.get("rlm")
    if isinstance(rlm, dict):
        return rlm.get("enabled") is True
    return bool(rlm)


def _skill_binding_config(node: Any) -> list[dict[str, Any]] | None:
    """``node.config.skill_binding`` opt-in — mirrors ``_rlm_opt_in``'s shape.

    A single ``{persona_path, trigger, require?, in_graph?}`` mapping OR a
    LIST of them (a node may need more than one skill actually invoked — e.g.
    the reviewer node invokes both ``skills/review/SKILL.md`` and
    ``skills/verify/SKILL.md``). Always normalised to a list. Absent (None)
    on every node in every existing workflow, so it is a no-op for everything
    except nodes that explicitly opt in.

    Present-but-malformed FAILS CLOSED — a misspelled/incomplete opt-in that
    is indistinguishable from "no binding" is exactly how an authority
    requirement gets skipped unnoticed. Only true absence opts out.
    """
    config = getattr(node, "config", None)
    if not isinstance(config, dict):
        return None
    if "skill_binding" not in config:
        return None  # truly absent — the only valid opt-out
    raw = config.get("skill_binding")
    items = raw if isinstance(raw, list) else [raw]
    if not items:
        raise AgentHandlerError(
            f"node {getattr(node, 'id', '?')!r}: skill_binding is empty"
        )
    for binding in items:
        if not isinstance(binding, dict):
            raise AgentHandlerError(
                f"node {getattr(node, 'id', '?')!r}: skill_binding must be a mapping "
                f"(or list of mappings), got {type(binding).__name__}"
            )
        missing = [k for k in ("persona_path", "trigger") if not binding.get(k)]
        if missing:
            raise AgentHandlerError(
                f"node {getattr(node, 'id', '?')!r}: skill_binding missing required "
                f"field(s) {missing!r}"
            )
    return items


def _observe_contract_enabled(node: Any, resolved_skills: list[Any]) -> bool:
    """Return whether advisor/observe output must be enforced.

    A resolved observe binding is itself the runtime authority marker, so it
    enables the contract automatically. The explicit config flag remains as
    a compatibility opt-in for callers without a skill binding.
    """
    config = getattr(node, "config", None)
    if isinstance(config, dict) and bool(config.get("observe_contract")):
        return True
    for skill in resolved_skills:
        parts = Path(str(getattr(skill, "skill_path", ""))).parts
        if tuple(parts[-3:]) == ("skills", "observe", "SKILL.md"):
            return True
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

    Loop-aware lookup: the static unroll expander rewrites a looped body
    node ``X`` into round copies ``X__r1 … X__rN``.  A real agent produces
    its declared outputs on every round regardless of the round-copy id, so
    the stub must too.  Lookup therefore tries the exact ``step_id`` first
    (letting convergence fixtures supply *per-round* outputs keyed by
    ``X__rk``) and, only on a miss, falls back to the declared id with the
    ``__r<k>`` suffix stripped (letting declared-id-keyed fixtures feed every
    round of a loop).  This keeps round copies transparent to the agent layer
    exactly as the retired runtime LOOP node was.
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
        if step_id in self.canned_outputs:
            return dict(self.canned_outputs[step_id])
        # Round-copy fallback: strip a trailing ``__r<k>`` and retry under the
        # declared body-node id.
        declared_id = re.sub(r"__r\d+$", "", step_id)
        return dict(self.canned_outputs.get(declared_id, {}))


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
        story_id = inputs.get("story_id")
        # Rebuild the brief and send it on dispatch too, so a reused/deduped/
        # cached issue is refreshed with the CURRENT brief (incl. any injected
        # skill) instead of running the body it was first created with.
        brief_body = self._build_brief_body(run_id, step_id, step_file_content, inputs)
        self._dispatch(
            tracker_id,
            agent,
            story_id=story_id if isinstance(story_id, str) and story_id else None,
            body=brief_body,
        )
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
        # #7 / Fix 6: Multica's task API does not report the pushed commit. For
        # integration runs, resolve the shared branch from the executor's
        # origin; daemon-local refs are reused and can be stale. Runs without an
        # integration target retain the local-checkout fallback.
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
        # s3-persist-review-findings: the validated review report, when
        # present, is authoritative over whatever outputs.yaml declared for
        # review_findings (see _harvest_review_report docstring).
        for key, value in self._harvest_review_report(terminal.get("work_dir")).items():
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

    def reharvest(
        self, work_dir: str | None, base: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        """Re-read a node's harvested outputs from an EXISTING work_dir WITHOUT
        re-dispatching.

        The #22 under-run guard uses this to recover from a race: the poll can
        report ``completed`` BEFORE the agent's commit / ``outputs.yaml`` has
        landed, so the harvest at poll time reads an empty tree. A blind
        re-dispatch then lands in a NEW empty work_dir and abandons the good
        one. Re-reading the SAME work_dir surfaces the late-landing work.
        """
        outputs: dict[str, Any] = dict(base or {})
        if not work_dir:
            return outputs
        for key, value in self._harvest_git_state(work_dir).items():
            if value is not None:
                outputs[key] = value
        for key, value in self._harvest_node_outputs(work_dir).items():
            outputs[key] = value
        for key, value in self._harvest_review_report(work_dir).items():
            outputs[key] = value
        for key, value in self._harvest_artifacts(work_dir).items():
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

        # Guard: only diff when repo_dir IS the git worktree root. When Multica
        # gives a node no checkout, ``_find_repo_checkout`` returns the dir that
        # merely *holds* ``.pHive/epics`` (no ``.git`` of its own). If that dir
        # happens to nest inside an unrelated parent repo (a consumer's repo, or
        # a pytest basetemp under this repo), ``git -C`` walks UP to the parent
        # and we would harvest the PARENT's committed epics as this run's output.
        # Return None so the caller falls back to the git-less worktree scan.
        toplevel = _git("rev-parse", "--show-toplevel")
        if toplevel is None or Path(toplevel).resolve() != repo_dir.resolve():
            return None

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
    def _harvest_review_report(work_dir: str | None) -> dict[str, Any]:
        """Dereference the reviewer's ``review-report.md`` into
        ``review_findings`` (s3-persist-review-findings).

        The reviewer contract requires this stable report file — living
        alongside ``outputs.yaml`` in the same ephemeral, gitignored
        ``.pHive/dag-outputs/`` scratch dir — on every review round, in
        addition to the terse ``review_findings`` scalar. When present, its
        VALIDATED content is authoritative for ``review_findings`` and
        overrides whatever ``_harvest_node_outputs`` already merged (a bare
        path string or a stale scalar). A missing, blank, or structurally
        invalid report is surfaced as an explicit empty string rather than
        silently keeping a truthy placeholder — this feeds the same #13
        under-run detection used for every other declared output, so a
        not-yet-flushed report is retried through the existing bounded
        reharvest/backoff path (#22/Fix 4) instead of passing as complete.

        No-op (``{}``) when no report file exists — non-review nodes, and
        any work_dir this glob does not match, are unaffected.
        """
        out: dict[str, Any] = {}
        if not work_dir:
            return out
        wd = Path(work_dir)
        try:
            candidates = sorted(wd.glob(_REVIEW_REPORT_GLOB))
        except OSError:
            return out
        if not candidates:
            return out
        try:
            text = candidates[0].read_text(encoding="utf-8")
        except OSError:
            return out
        out["review_findings"] = text if _is_valid_review_report(text) else ""
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
        if rels is None and not (repo_dir / ".git").exists():
            # No git at all (fresh single-epic worktree) — a glob scan is correct
            # here; there is no pre-existing history to confuse it with.
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
        elif rels is None:
            # FAIL CLOSED: a real git checkout with no resolvable base ref cannot
            # safely tell THIS run's committed files from a consumer repo's
            # pre-existing epics — scanning all of them would over-harvest and
            # falsely satisfy declared outputs. Harvest nothing committed.
            rels = []

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

    def _harvest_git_state(self, work_dir: str | None) -> dict[str, Any]:
        """Derive the agent's commit metadata from its work_dir checkout (#7).

        Multica's task API does not report what the agent committed/pushed, so
        the poll terminal has no sha/branch/repo. The agent's isolated work_dir
        IS a real git checkout, so we read it directly.

        Ref selection (Fix 6): Multica reuses daemon workspaces. Their local
        ``feat/<epic>`` ref can stay pinned to an old, even divergent commit while
        agents push fresh work to ``origin/feat/<epic>``. Therefore an integration
        run resolves the branch from the EXECUTOR checkout's authoritative
        ``origin`` and makes reconcile fetch that same source. A daemon-local HEAD
        remains only the fallback for runs with no integration target.

        - ``code_push_sha`` / ``commit_sha`` <- the chosen ref's tip
        - ``branch`` <- the chosen ref's name, except daemon-owned ``agent/*``
          refs, which are suppressed so reconcile can mint a SHA-derived ref
        - ``repo`` <- ``origin`` for an integration-branch SHA, otherwise the
          checkout path for the local-ref fallback
        - ``work_dir`` <- the agent checkout path for semantic/artifact harvest

        Returns ``{}`` if no checkout/git is found. Once an integration target
        exists, failure to resolve its authoritative remote ref is fatal rather
        than silently falling back to a known-stale daemon branch.
        """
        out: dict[str, Any] = {}
        repo_dir = self._find_repo_checkout(work_dir)
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

        head_sha = _git("rev-parse", "HEAD")
        head_branch = _git("rev-parse", "--abbrev-ref", "HEAD")

        target = self._target_branch()
        local_target_sha = (
            _git("rev-parse", "--verify", "--quiet", target) if target else None
        )
        remote_commit_sha = (
            self._remote_target_commit(target, (head_sha, local_target_sha))
            if target
            else None
        )
        if target and not remote_commit_sha:
            raise AgentHandlerError(
                f"could not verify the task commit on authoritative remote ref "
                f"origin/{target!s} while harvesting Multica work_dir {repo_dir}"
            )

        chosen_sha = head_sha
        chosen_branch = head_branch
        source_repo = str(repo_dir)
        # The remote integration ref is ALWAYS authoritative for integration
        # runs, including when it already equals executor HEAD. Falling through
        # in that equality case would re-enable the stale daemon-local target
        # arbitration on the very next no-op/review node.
        if target and remote_commit_sha:
            chosen_sha, chosen_branch = remote_commit_sha, target
            source_repo = "origin"
        if chosen_sha:
            out["code_push_sha"] = chosen_sha
            out["commit_sha"] = chosen_sha
        if (
            chosen_branch
            and chosen_branch != "HEAD"
            and not chosen_branch.startswith("agent/")
        ):
            out["branch"] = chosen_branch
        out["repo"] = source_repo
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

    def _target_branch(self) -> str:
        """The executor's epic/integration branch — ``repo_root``'s current
        branch when it is a NON-default branch. Returns "" on the default branch
        (e.g. plan, which creates its own epic branch), when no origin default
        resolves, or for a non-git ``repo_root`` (unit tests / local binding) —
        preserving those flows.

        This is both the branch the Repo branch contract tells agents to commit
        to AND the branch the harvest treats as authoritative for the agent's
        commit (a drifted HEAD on the daemon's auto-branch must not strand it).
        Best-effort: returns "" if git can't resolve the branch.
        """
        if self._repo_root is None or not (self._repo_root / ".git").exists():
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
        if default is None:
            # No resolvable remote default (no origin remote / bare local repo).
            # The contract's `git fetch origin {branch}` would misdirect a run in
            # a repo without an origin — emit nothing. (CodeRabbit review of #316.)
            return ""
        if branch == default:
            return ""  # default branch — no epic-branch directive
        return branch

    def _remote_target_commit(
        self, branch: str, local_candidates: tuple[str | None, ...]
    ) -> str | None:
        """Return this task's commit once ``origin/<branch>`` contains it.

        Both daemon HEAD and its local integration ref are candidate sources:
        Multica topologies have left either one at base after committing on the
        other. Candidates already contained by executor HEAD are stale/no-op and
        discarded. We then poll through the terminal-before-push race, fetch the
        exact remote ref without updating tracking refs, and prove a remaining
        candidate is reachable from a stable advertised remote tip. Returning
        that candidate (not a possibly-later tip) preserves task provenance.
        """
        if not branch or self._repo_root is None:
            return None
        def _run(*args: str) -> subprocess.CompletedProcess[str] | None:
            try:
                return subprocess.run(
                    ["git", "-C", str(self._repo_root), *args],
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            except (OSError, subprocess.SubprocessError):
                return None

        executor_head = _run("rev-parse", "HEAD")
        if executor_head is None or executor_head.returncode != 0:
            return None
        executor_sha = executor_head.stdout.strip()
        if not re.fullmatch(r"[0-9a-fA-F]{40}", executor_sha):
            return None

        candidates: list[str] = []
        for raw in local_candidates:
            candidate = raw or ""
            if not re.fullmatch(r"[0-9a-fA-F]{40}", candidate):
                continue
            candidate = candidate.lower()
            if candidate in candidates:
                continue
            contained = _run("merge-base", "--is-ancestor", candidate, executor_sha)
            if contained is None or contained.returncode != 0:
                candidates.append(candidate)
        if not candidates:
            candidates.append(executor_sha.lower())

        ref = f"refs/heads/{branch}"
        for delay_s in _REMOTE_LOOKUP_DELAYS_S:
            if delay_s:
                time.sleep(delay_s)
            result = _run("ls-remote", "--exit-code", "origin", ref)
            if result is None or result.returncode != 0:
                continue
            remote_sha = ""
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[1] == ref:
                    remote_sha = parts[0].lower()
                    break
            if not re.fullmatch(r"[0-9a-f]{40}", remote_sha):
                continue
            fetched = _run(
                "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "origin", ref
            )
            if fetched is None or fetched.returncode != 0:
                continue
            confirmed = _run("ls-remote", "--exit-code", "origin", ref)
            if confirmed is None or confirmed.returncode != 0:
                continue
            confirmed_parts = confirmed.stdout.split()
            if len(confirmed_parts) != 2 or confirmed_parts[0].lower() != remote_sha:
                continue
            reachable_candidates: list[str] = []
            for candidate in candidates:
                reachable = _run("merge-base", "--is-ancestor", candidate, remote_sha)
                if reachable and reachable.returncode == 0:
                    reachable_candidates.append(candidate)
            # If both local refs are reachable, prefer the newer one in their
            # ancestry chain rather than whichever ref happened to be listed
            # first. This handles HEAD-at-base / target-at-task and its inverse.
            for candidate in reachable_candidates:
                has_reachable_descendant = False
                for other in reachable_candidates:
                    if other == candidate:
                        continue
                    older = _run("merge-base", "--is-ancestor", candidate, other)
                    if older and older.returncode == 0:
                        has_reachable_descendant = True
                        break
                if has_reachable_descendant:
                    continue
                return candidate
        return None

    def _branch_contract(self) -> str:
        """Brief preamble telling the agent to base its work on the executor's
        target branch (#15), when ``repo_root`` is on a non-default (epic)
        branch. Empty on the default branch (e.g. plan, which creates its own
        epic branch) — preserving that flow. Best-effort: returns "" if git
        can't resolve the branch.
        """
        branch = self._target_branch()
        if not branch:
            return ""
        return (
            "## Repo branch contract — FIRST ACTION (overrides the daemon's auto-checkout)\n\n"
            f"The DAG executor reconciles your commit FROM the `{branch}` branch (the epic "
            "branch). The Multica daemon auto-checks-out the repo's default branch; you must "
            f"move to `{branch}` before doing any work:\n\n"
            "```bash\n"
            f"git fetch origin {branch}\n"
            f"git checkout -B {branch} origin/{branch}\n"
            "```\n\n"
            f"Do ALL work and commits on `{branch}`. Do NOT commit on the daemon's "
            "auto-created `agent/<persona>/<task>` branch — commits there will not reconcile "
            "into the run."
        )

    def _build_brief_body(
        self,
        run_id: str,
        step_id: str,
        step_file_content: str,
        inputs: dict[str, Any] | None = None,
    ) -> str:
        """Render the agent's brief (issue body): branch contract + inputs JSON
        + verbatim step_file (which carries any injected skill). Deterministic
        for a given (run, step, brief) so it can be built for BOTH create-issue
        and — crucially — every dispatch, so a reused/deduped/cached issue is
        REFRESHED with the current brief rather than running the stale one it
        was first created with (PR #74 review P1: stale-brief invocation)."""
        # #12: the issue body IS the agent's brief. It must carry the node's
        # `inputs` — the requirement and upstream outputs (research_brief,
        # design_discussion, ...) — not just the step_file.
        body_parts: list[str] = []
        # #15: inject the single-shared-branch contract so the agent bases work
        # on the target branch (empty on default-branch flows).
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
        return "\n\n".join(body_parts) or (
            f"(no step_file provided — run {run_id} step {step_id})"
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
        body = self._build_brief_body(run_id, step_id, step_file_content, inputs)

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
        create_args = ["create-issue", "--title", title, "--body", body, "--dedup-title", title]
        # Bind the issue to the epic branch at creation so the daemon can key
        # branch-shared worktree reuse off the structured integration_branch column
        # (the body contract alone is not machine-readable). Empty on the default
        # branch / non-git repo_root — preserves those flows.
        create_branch = self._target_branch()
        if create_branch:
            create_args += ["--integration-branch", create_branch]
        result = self._run_cli_fast(create_args)
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

    def _dispatch(
        self,
        tracker_id: str,
        agent: str,
        story_id: str | None = None,
        body: str | None = None,
    ) -> None:
        args = ["dispatch", "--issue", tracker_id, "--agent", agent]
        # Refresh the issue description with the current brief. cli.mjs's
        # dispatch refresh path (suppliedBody) was previously unreachable
        # because Python never sent --body, so a reused issue silently ran a
        # stale brief while the handler still stamped skill_invoked.
        if body:
            args += ["--body", body]
        # Single-shared-branch contract (t-007): when the executor is on an epic
        # branch, tell the agent to base its work on AND push back to that branch
        # (origin/{branch}) rather than committing to the daemon's throwaway
        # agent/<persona>/<task> branch. cli.mjs injects renderIntegrationContract
        # into the issue body idempotently. Every agent then resets to origin tip
        # and pushes its commit there, so downstream nodes/stories build on real
        # prior work and reconcile stays a clean fast-forward (no stale base, no
        # detached-HEAD harvest). Empty branch (default-branch flows, non-git
        # repo_root) → omit, preserving the harvest fallback.
        branch = self._target_branch()
        if branch:
            args += ["--integration-branch", branch]
            if story_id:
                args += ["--story-id", story_id]
        # Node issue ids are deterministic per (epic, story, node), so RESTARTING
        # a previously-failed run re-targets the same issue — whose latest task is
        # terminal from the prior run, making a plain dispatch a no-op
        # (STALE_TERMINAL_TASK). HIVE_MULTICA_FORCE_RERUN opts a restart into
        # resetting such a terminal issue to a fresh dispatchable state. It is a
        # no-op on a fresh issue (cli.mjs only resets when the latest task is
        # terminal; an in_progress same-assignee issue still short-circuits as
        # already_dispatched), so it is safe to pass for every node of a rerun.
        if os.environ.get("HIVE_MULTICA_FORCE_RERUN", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            args.append("--rerun")
        self._run_cli_fast(args)

    def _poll(self, tracker_id: str) -> dict[str, Any]:
        """Terminal status for a dispatched tracker issue.

        s4: `cli.mjs poll` (episode-sync.mjs `pollTaskUntilTerminal`) is
        event-driven for Agent-based bg dispatch — each iteration of its
        network-poll loop checks the s1 SubagentStop complete.json marker
        for the task's agent_id FIRST and returns the instant it appears
        (a filesystem stat), rather than waiting out the full HTTP poll
        interval. The marker check lives there, not here, because that is
        where the existing bounded wait loop already runs (this call's
        `timeout_ms` is the same bound that governed the pre-s4 timer-poll,
        so a missing/late marker still falls back to plain polling within
        the SAME bound — never an unbounded wait). This method's shape is
        otherwise unchanged: one call, one terminal-shaped result.

        Carve-out: Bash `run_in_background` work has no completion hook in
        this runtime and cannot use the marker — out of scope here because
        MulticaAgentSpawn only ever dispatches Agent-based work.
        """
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
        *,
        rlm_binding_resolver: Callable[[str], Any] | None = None,
        rlm_metric_writer: Callable[[dict[str, Any], str], None] | None = None,
    ) -> None:
        self._spawn = spawn
        self._repo_root = Path(repo_root) if repo_root is not None else None
        # a-rlm-recursive-node A (EXPERIMENTAL, flag-gated): injection seams for
        # the RLM recursive wrapper. Both default None and are consulted ONLY on
        # the ``node.config.rlm`` opt-in path, so a non-rlm node never touches
        # them and the handler stays byte-identical to pre-A.
        self._rlm_binding_resolver = rlm_binding_resolver
        self._rlm_metric_writer = rlm_metric_writer
        # Inspection handle: the wrapper built for the most recent rlm node.
        self._last_rlm_wrapper: Any = None
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

    def _resolve_plugin_path(self, rel_or_abs: str, *, label: str) -> str:
        """Resolve a plugin-shipped path (step_file, persona) against the same
        plugin_root -> repo_root -> legacy-as-given search order used for
        step_files, returning a path string usable as-is by any reader.

        Kept as a path resolver (not a reader) so callers that only need the
        path — e.g. ``resolve_skill_binding``, which does its own reading —
        don't pay for a redundant read here.
        """
        path = Path(rel_or_abs)
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
            if candidate.is_file():
                return str(candidate)
            last_not_found = FileNotFoundError(str(candidate))

        if not roots:
            return rel_or_abs

        raise AgentHandlerError(
            f"{label} not found: {rel_or_abs}"
        ) from last_not_found

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
        resolved = self._resolve_plugin_path(step_file, label="step_file")
        try:
            return Path(resolved).read_text(encoding="utf-8")
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

        story_id = inputs.get("story_id")
        if (
            story_id
            and _story_spec_is_empty(inputs.get("story_spec"))
        ):
            raise FatalAgentHandlerError(
                f"story_spec is null/empty for story={story_id} — "
                "refusing to dispatch a spec-less agent"
            )

        step_file_content = ""
        if node.step_file:
            step_file_content = self._read_step_file(node.step_file)

        # Match-resolve-load-invoke seam (see hive/lib/skill_binding.py). A node
        # opting in via ``config.skill_binding`` gets its bound skill actually
        # resolved, loaded, and injected into the brief HERE — by executable
        # code, not by asking the spawned agent to run the resolver itself from
        # step_file prose (an inert binding otherwise: the agent can skip step 2
        # and nothing catches it). Fails closed: a missing/unreadable binding
        # raises before the agent is ever spawned.
        resolved_skills: list = []
        skill_binding_cfgs = _skill_binding_config(node)
        if skill_binding_cfgs is not None:
            injections: list[str] = []
            for cfg in skill_binding_cfgs:
                persona_path = self._resolve_plugin_path(
                    cfg["persona_path"], label="skill_binding persona"
                )
                persona_real = Path(persona_path).resolve()
                # Bind a persona to exactly one trust domain. A union of the
                # plugin and consumer roots lets ambient path expansion swap a
                # trusted plugin skill for consumer-controlled content. Pick
                # the root that actually supplied this persona, then use that
                # same explicit root for both variable expansion and realpath
                # containment. Rootless explicit personas are confined to
                # their own directory rather than gaining an unbounded path.
                persona_root: Path | None = None
                candidate_roots = [
                    r.resolve()
                    for r in (self._plugin_root, self._repo_root, default_plugin_root())
                    if r is not None
                ]
                for candidate_root in candidate_roots:
                    try:
                        persona_real.relative_to(candidate_root)
                    except ValueError:
                        continue
                    persona_root = candidate_root
                    break
                if persona_root is None:
                    persona_root = persona_real.parent
                try:
                    rs = resolve_skill_binding(
                        persona_path,
                        cfg["trigger"],
                        require_binding=bool(cfg.get("require", True)),
                        allowed_roots=[str(persona_root)],
                        plugin_root=str(persona_root),
                    )
                except SkillBindingError as exc:
                    raise AgentHandlerError(
                        f"skill binding fail-closed for node {node.id!r}: {exc}"
                    ) from exc
                if rs is not None:
                    resolved_skills.append(rs)
                    injections.append(
                        build_skill_injection(rs, in_graph=bool(cfg.get("in_graph", False)))
                    )
            if injections:
                step_file_content = "\n\n".join(injections) + "\n\n" + step_file_content

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
        # Bound skills are executable contracts on every spawn backend, not
        # merely prompt decoration. Local/session/test backends must not report
        # success while omitting declared evidence such as verify_evidence.
        # Unbound local nodes preserve their historical permissive behaviour.
        enforce_declared_outputs = bool(semantic_outputs) and (
            is_multica or bool(resolved_skills)
        )
        max_under_run_attempts = 3 if (is_multica and semantic_outputs) else 1

        # #13-enforce: prepend a hard output-contract to the brief for Multica
        # nodes that declare semantic outputs, so an intermittently-flaky agent
        # turn cannot silently end without emitting outputs.yaml — the dominant
        # #22 under-run cause, independent of story difficulty (observed on a
        # trivial preflight as readily as on an architectural implement). The
        # step content itself is still passed VERBATIM after the contract; local
        # and test spawns consume canned outputs and get no contract.
        effective_step_file = step_file_content
        if is_multica and semantic_outputs:
            # Bracket the brief: the prepended preamble is read FIRST and then
            # forgotten by turn-end after a long task (observed: the tester ran
            # the dev-supplied passing tests, reported done, and skated past the
            # gitignored outputs.yaml write). Appending the same obligation as the
            # LAST thing the agent sees keeps it salient at the stop boundary —
            # the moment the write is actually due.
            effective_step_file = (
                _output_contract_preamble(semantic_outputs)
                + step_file_content
                + _output_contract_closer(semantic_outputs)
            )

        def _filled(o: dict[str, Any]) -> int:
            return sum(1 for n in semantic_outputs if not _output_is_empty(o.get(n)))

        def _missing(o: dict[str, Any]) -> list[str]:
            return [n for n in semantic_outputs if _output_is_empty(o.get(n))]

        def _apply_skill_evidence(o: dict[str, Any]) -> dict[str, Any]:
            """Overlay harness-owned evidence after every spawn/harvest."""
            if not resolved_skills:
                return o
            stamped = dict(o)
            paths = [rs.skill_path for rs in resolved_skills]
            stamped["skill_invoked"] = paths[0] if len(paths) == 1 else paths
            return stamped

        # a-rlm-recursive-node A: flag-gate. When node.config.rlm opts in, run the
        # spawn through the RLM recursive harness (constrained toolset + depth-1
        # register_binding sub-call + measured metric). When the flag is
        # absent/false, ``active_spawn is self._spawn`` — the SAME object called
        # with the SAME args, so the non-rlm path is byte-identical to pre-A.
        #
        # codex finding 2: the opt-in decision is a MINIMAL inline config check
        # (``_rlm_opt_in``, no rlm.py import) so a flag-off node NEVER imports the
        # RLM module — pre-A had no such dependency. The heavy wrapper is imported
        # ONLY inside the true (opt-in) branch.
        active_spawn: Any = self._spawn
        if _rlm_opt_in(node):
            from .rlm import RLMRecursiveWrapper

            active_spawn = RLMRecursiveWrapper(
                self._spawn,
                node,
                binding_resolver=self._rlm_binding_resolver,
                metric_writer=self._rlm_metric_writer,
            )
            self._last_rlm_wrapper = active_spawn

        outputs: dict[str, Any] = {}
        attempt_work_dirs: list[str] = []
        # Each work_dir's OWN attempt outputs (sha/branch/repo/work_dir). When a
        # prior work_dir is recovered below, it must keep ITS attempt's metadata,
        # not the latest attempt's — else reconcile/copy target the wrong tree.
        attempt_outputs_by_work_dir: dict[str, dict[str, Any]] = {}
        for attempt in range(1, max_under_run_attempts + 1):
            try:
                outputs = active_spawn(
                    agent=node.agent,
                    step_file_content=effective_step_file,
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

            outputs = _apply_skill_evidence(outputs)

            wd = outputs.get("work_dir")
            if isinstance(wd, str) and wd:
                if wd not in attempt_work_dirs:
                    attempt_work_dirs.append(wd)
                attempt_outputs_by_work_dir[wd] = dict(outputs)

            # The injected #13 contract requires EVERY declared output; a partial
            # outputs.yaml is incomplete and must not flow downstream. Treat a run
            # missing ANY semantic output as an under-run (not only all-empty).
            under_run = bool(_missing(outputs))
            if not (is_multica and under_run):
                break

            # #22 efcl-s4: an under-run is usually a RACE, not a no-op — the poll
            # reported 'completed' before the agent's commit / outputs.yaml had
            # landed, so the harvest at poll time read an empty tree. A blind
            # re-dispatch lands in a NEW empty work_dir and ABANDONS the good one
            # (observed: 3 attempts each in a distinct work_dir, only the first
            # actually held the authored epic). Before spending a re-dispatch,
            # re-harvest every work_dir seen so far — a late-landing commit now
            # surfaces — seeding each candidate with ITS OWN attempt metadata so a
            # recovered earlier work_dir doesn't inherit a later attempt's tree.
            recovered: dict[str, Any] | None = None
            for delay_s in _REHARVEST_DELAYS_S:
                if delay_s:
                    time.sleep(delay_s)
                for prior in attempt_work_dirs:
                    cand = self._spawn.reharvest(
                        prior, base=attempt_outputs_by_work_dir.get(prior)
                    )
                    if _filled(cand) > _filled(recovered or {}):
                        recovered = cand
                # Accept only a COMPLETE recovery — every declared output
                # present. A partial outputs.yaml never flows downstream.
                if recovered is not None and not _missing(recovered):
                    outputs = _apply_skill_evidence(recovered)
                    break
            if recovered is not None and not _missing(recovered):
                break

            if attempt >= max_under_run_attempts:
                raise AgentHandlerError(
                    f"node {node.id!r}: agent reported completed but did not produce "
                    f"all declared outputs {semantic_outputs}; missing "
                    f"{_missing(recovered or outputs)} after "
                    f"{max_under_run_attempts} attempts (under-run)"
                )

        outputs = _apply_skill_evidence(outputs)
        missing_outputs = _missing(outputs)
        if enforce_declared_outputs and missing_outputs:
            raise AgentHandlerError(
                f"node {node.id!r}: agent did not produce all declared outputs; "
                f"missing {missing_outputs}"
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

        # Observe-contract enforcement (PR #74 review P1). Resolving the
        # observe skill enables this automatically; config.observe_contract is
        # retained only as a compatibility opt-in for unbound callers.
        # The contract is enforced HERE, at the runtime boundary, BEFORE the
        # output is returned and can flow downstream as advice — not only in a
        # test that inspects the payload after the fact. An advisor output that
        # claims/implies a gate verdict or a blocking instruction fails the node
        # closed rather than being forwarded.
        if _observe_contract_enabled(node, resolved_skills):
            result = validate_observe_output(
                {k: v for k, v in outputs.items() if k not in _SPAWN_METADATA_OUTPUTS}
            )
            if not result.accepted:
                raise AgentHandlerError(
                    f"node {node.id!r}: observe/advisor output violates the observe "
                    f"contract (advisor is verdict-free, non-blocking): "
                    f"{'; '.join(result.violations)}"
                )

        return NodeOutput(outputs=outputs)
