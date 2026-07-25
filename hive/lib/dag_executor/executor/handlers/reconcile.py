"""Reconcile handler — fetch + ff-merge agent commits before the gate.

Invokes `cli.mjs reconcile --repo <repo> --branch <branch> --sha <sha>`
via subprocess. Must be an explicit graph node between any Multica agent
node and its downstream gate so the gate provably validates real committed
files (R5 — not an empty/stale tree).

Local binding no-op: when `inputs["sha"]` is absent or empty the node
returns immediately. This covers runs where the AgentHandler used the
local binding (work already in the tree) and there is no remote commit
to harvest.

Non-ff or missing sha (after a Multica run) → ReconcileHandlerError is
raised loud; the gate must never run against a stale tree.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from hive.lib.config import resolve_state_dir
from ..errors import ReconcileHandlerError
from .agent import NodeOutput


class ReconcileHandler:
    """Materialises an agent's committed work into the working tree.

    Constructor parameters mirror MulticaAgentSpawn for consistency:
      cli_path  — path to hive/lib/multica-story-dispatch/cli.mjs
      node_bin  — node executable (default "node")
      timeout_ms — subprocess timeout in milliseconds (default 120 s)
    """

    # Re-entrancy: per-node invocation within a parallel dispatch group is safe.
    # The local-binding path (no sha) is a no-op; the copytree path uses
    # dirs_exist_ok=True (idempotent). The git ff-merge path calls cli.mjs as a
    # blocking subprocess; concurrent calls to the same work-dir would contend on
    # .git/index.lock, but no current workflow dispatches two reconcile nodes in
    # the same parallel wave. Walker._per_node_reconcile serializes them.

    _DEFAULT_TIMEOUT_MS = 120_000

    def __init__(
        self,
        *,
        cli_path: str | Path | None = None,
        node_bin: str = "node",
        timeout_ms: int = _DEFAULT_TIMEOUT_MS,
        repo_root: Path | str | None = None,
        state_dir: Path | str | None = None,
    ) -> None:
        self._cli_path = Path(cli_path) if cli_path else self._default_cli_path()
        self._node_bin = node_bin
        # The merge TARGET: the executor's repo_root (the project tree the
        # downstream gate validates). The agent's work_dir is only the fetch
        # SOURCE. See handle() / #8.
        self._repo_root = Path(repo_root).resolve() if repo_root is not None else None
        self._timeout_ms = timeout_ms
        # s2: root of the s1 SubagentStop marker tree
        # (<state_dir>/agent-complete/<agent_id>/complete.json). Explicit
        # override for tests/non-standard layouts; production wiring resolves
        # it the same way the hook does (resolve_state_dir, HIVE_STATE_DIR /
        # hive.config.yaml precedence) so both sides agree on one path.
        self._state_dir = Path(state_dir) if state_dir is not None else None

    @staticmethod
    def _default_cli_path() -> Path:
        # reconcile.py is at hive/lib/dag_executor/executor/handlers/reconcile.py
        # cli.mjs  is at hive/lib/multica-story-dispatch/cli.mjs
        here = Path(__file__).resolve().parent
        return (here / "../../../multica-story-dispatch/cli.mjs").resolve()

    def _marker_root(self) -> Path:
        if self._state_dir is not None:
            state_dir = self._state_dir
        else:
            cwd = self._repo_root if self._repo_root is not None else Path.cwd()
            state_dir = Path(resolve_state_dir(cwd=cwd, env=dict(os.environ)))
        return state_dir / "agent-complete"

    def _read_marker(self, agent_id: str) -> dict[str, Any] | None:
        """Read the s1 complete.json marker for one exact agent_id.

        Keyed lookup, not a directory scan: complete.json fires for EVERY
        subagent (researchers, reviewers, ...), but `agent_id` here comes
        1:1 from the SAME upstream AgentHandler step that produced this
        node's sha/branch/repo (agent.py's poll terminal resolves agent_id
        for the dispatched tracker_id). Reading only that key naturally
        ignores every other subagent's marker (R2) without needing a
        separate tracker_id cross-check.
        """
        marker_path = self._marker_root() / agent_id / "complete.json"
        try:
            raw = marker_path.read_text(encoding="utf-8")
        except OSError:
            return None
        try:
            data = json.loads(raw)
        except ValueError:
            return None
        return data if isinstance(data, dict) else None

    def _delete_marker(self, agent_id: str) -> None:
        """Consume (delete) a marker once read.

        Critical #2: `agent_id` is a stable persona UUID reused across every
        story that persona ever runs, not a per-run id. An unconsumed marker
        left on disk would be available for a LATER reconcile call (a
        different tracker_id, same recycled agent_id) to read and mistake for
        its own — best-effort cleanup here closes that window. Never raises;
        a failed cleanup must not fail an otherwise-successful reconcile.
        """
        marker_path = self._marker_root() / agent_id / "complete.json"
        try:
            marker_path.unlink()
        except OSError:
            pass

    @staticmethod
    def _marker_is_fresh(marker: dict[str, Any], started_at: Any) -> bool:
        """Guard against a marker written before this dispatch even started
        (Critical #2b). `started_at` is optional — older callers/tests that
        don't wire it through get the pre-existing (accept) behavior rather
        than a spurious rejection.
        """
        if not started_at:
            return True
        written_at = marker.get("written_at")
        if not written_at:
            return True
        from datetime import datetime

        def _parse(value: str) -> datetime | None:
            try:
                return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                return None

        written = _parse(written_at)
        started = _parse(started_at)
        if written is None or started is None:
            return True
        return written >= started

    @staticmethod
    def _derive_branch_from_repo(derive_src: str, sha: str) -> str:
        """Resolve a branch name from a repo path's HEAD, minting a stable
        sha-derived ephemeral branch when HEAD is detached or on a daemon-owned
        ``agent/*`` ref. Shared by both the marker path (derive_src =
        complete.json's cwd) and the legacy poll-terminal fallback (derive_src
        = repo/work_dir input).
        """
        if not derive_src:
            return ""
        try:
            probe = subprocess.run(
                ["git", "-C", derive_src, "rev-parse", "--abbrev-ref", "HEAD"],
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            candidate = probe.stdout.strip()
            if (
                probe.returncode == 0
                and candidate
                and candidate != "HEAD"
                and not candidate.startswith("agent/")
            ):
                return candidate
        except (OSError, subprocess.SubprocessError):
            pass
        if not sha:
            return ""
        # Detached or daemon-owned agent/* HEAD — the commit is still reachable
        # by sha; mint a stable ephemeral branch at it so the reconcile CLI
        # (which fetches refs/heads/<branch>) can pull it. sha-derived naming
        # keeps retries idempotent and collision-free with epic/agent branches.
        ephemeral = f"reconcile-harvest/{sha[:12]}"
        try:
            minted = subprocess.run(
                ["git", "-C", derive_src, "branch", "-f", ephemeral, sha],
                text=True,
                capture_output=True,
                timeout=30,
                check=False,
            )
            if minted.returncode == 0:
                return ephemeral
        except (OSError, subprocess.SubprocessError):
            pass
        return ""

    @staticmethod
    def _find_epic_source(work_dir: str, epic_dir: str) -> Path | None:
        """Locate the agent's written epic dir inside its work_dir — the work_dir
        itself, or a single repo-checkout subdir under it (Multica nests the
        checkout, e.g. ``<work_dir>/ttt-throwaway/``). Returns the dir that
        actually contains ``<epic_dir>/epic.yaml``, or ``None``.
        """
        if not work_dir or not epic_dir:
            return None
        wd = Path(work_dir)
        try:
            candidates = [wd] + sorted(p for p in wd.iterdir() if p.is_dir())
        except OSError:
            return None
        for base in candidates:
            src = base / epic_dir
            if (src / "epic.yaml").exists():
                return src
        return None

    def _materialize_epic_if_missing(
        self, node_id: str, work_dir: str, epic_dir: str
    ) -> bool:
        """Copy the agent's epic into repo_root when git did not.

        Multica agents commit inconsistently — a plan author can WRITE the epic
        (epic.yaml + stories) but leave it untracked, so its HEAD is the base
        commit and the ff-merge is a no-op that materialises nothing. The
        downstream output-validation gate then fails ``epic.yaml not found in
        repo_root``. When the epic is absent from repo_root after the git step,
        copy it straight from the agent's work_dir checkout. Idempotent: skips
        when the epic is already present (the agent DID commit and git merged it).
        """
        if self._repo_root is None or not epic_dir:
            return False
        # epic_dir is UPSTREAM AGENT OUTPUT (harvest / #13 outputs.yaml), not a
        # trusted constant. An absolute path or a ``..`` traversal would make
        # ``shutil.copytree`` write OUTSIDE repo_root — arbitrary filesystem
        # write driven by whatever the agent emitted. Require a relative path
        # that resolves within repo_root; reject loud otherwise. (Codex #316.)
        rel = Path(epic_dir)
        dest = self._repo_root / rel
        if rel.is_absolute() or not dest.resolve().is_relative_to(self._repo_root):
            raise ReconcileHandlerError(
                f"reconcile node {node_id!r}: refusing unsafe epic_dir "
                f"{epic_dir!r} — must be a relative path inside repo_root"
            )
        if (dest / "epic.yaml").exists():
            return False  # git reconcile already materialised it
        src = self._find_epic_source(work_dir, epic_dir)
        if src is None:
            return False
        try:
            shutil.copytree(src, dest, dirs_exist_ok=True)
        except OSError as exc:
            raise ReconcileHandlerError(
                f"reconcile node {node_id!r}: failed to copy uncommitted epic "
                f"{src} -> {dest}: {exc}"
            ) from exc
        return True

    def handle(
        self,
        node: Any,
        inputs: dict[str, Any],
        run_id: str,
    ) -> NodeOutput:
        sha = inputs.get("sha") or ""
        branch = inputs.get("branch") or ""
        repo = inputs.get("repo") or ""
        work_dir = inputs.get("work_dir") or ""
        epic_dir = inputs.get("epic_dir") or ""

        # Local binding: no sha means work is already in the tree — clean no-op,
        # but still materialise an uncommitted epic from the work_dir if one is
        # named and missing from repo_root (Multica agents write-without-commit).
        if not sha:
            copied = self._materialize_epic_if_missing(node.id, work_dir, epic_dir)
            return NodeOutput(
                outputs={"reconcile_status": "noop"},
                meta={"reconcile": "noop", "epic_copied": copied},
            )

        # s2: marker-driven correlation + failure-detection for Agent-based
        # dispatches. agent_id is bound from the same upstream AgentHandler
        # step that produced sha/branch/repo, so its complete.json is the
        # authoritative "did this tracked story agent actually finish"
        # signal — independent of whatever the poll-terminal path returned.
        # A missing marker or a non-success verdict means the story failed;
        # reconcile must not silently ff-merge a stale/absent commit.
        agent_id = inputs.get("agent_id") or ""
        if agent_id:
            marker = self._read_marker(agent_id)
            fresh = marker is not None and self._marker_is_fresh(marker, inputs.get("started_at"))
            verdict = marker.get("verdict") if fresh else None
            # Consume the marker now that it's been read (fresh or not) so a
            # later reconcile call for this same recycled agent_id can never
            # read it again (Critical #2).
            if marker is not None:
                self._delete_marker(agent_id)
            if verdict != "success":
                raise ReconcileHandlerError(
                    f"reconcile node {node.id!r}: agent {agent_id!r} "
                    f"(tracker {inputs.get('tracker_id') or 'unknown'!r}) has no "
                    f"successful complete.json marker (verdict={verdict!r}) — "
                    "treating as failed, not merging"
                )
            if not branch:
                # complete.json has no branch key (frozen CC 2.1.200 payload
                # shape) — derive it from the marker's recorded cwd (the
                # agent's worktree), not a subprocess probe against repo/work_dir.
                branch = self._derive_branch_from_repo(marker.get("cwd") or "", sha)

        if not branch:
            # Legacy poll-terminal fallback (no agent_id wired to this node —
            # pre-s2 workflows, or non-Multica local bindings): the Multica
            # poll-terminal path can omit `branch` even when the agent
            # committed (agent.py:366 — terminal carries no branch). Recover
            # it from the agent repo's HEAD symbolic name rather than failing
            # the reconcile. Retained as the s4 carve-out fallback.
            derive_src = repo or work_dir
            branch = self._derive_branch_from_repo(derive_src, sha)
        if not branch:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r}: 'branch' input required when sha is set "
                f"(and could not be derived from the agent repo HEAD)"
            )
        if not repo:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r}: 'repo' input required when sha is set"
            )

        # #8: the ff-merge must run in the executor's repo_root (the project the
        # gate validates), fetching FROM the agent's committed repo (`repo`).
        # Previously --work-dir was wired to the agent's own work_dir, so the
        # merge ran inside the agent's repo (which already held the commit ->
        # "Already up to date") and never materialised the work into repo_root.
        # Fall back to the work_dir input only when no repo_root is configured
        # (e.g. local binding, where the agent already worked in the tree).
        merge_target = str(self._repo_root) if self._repo_root else work_dir

        args = ["reconcile", "--repo", repo, "--branch", branch, "--sha", sha]
        if merge_target:
            args += ["--work-dir", merge_target]

        cmd = [self._node_bin, str(self._cli_path)] + args
        timeout_s = self._timeout_ms / 1000.0

        try:
            result = subprocess.run(
                cmd,
                text=True,
                capture_output=True,
                timeout=timeout_s,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} timed out after {self._timeout_ms} ms"
            ) from exc

        if result.returncode != 0:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} failed (exit {result.returncode}): "
                f"{result.stderr.strip()}"
            )

        try:
            data = json.loads(result.stdout)
        except ValueError as exc:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} cli.mjs returned non-JSON: "
                f"{result.stdout[:200]!r}"
            ) from exc

        if not isinstance(data, dict):
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r} cli.mjs returned non-dict "
                f"({type(data).__name__})"
            )

        # Even after a successful git step the epic may be absent from repo_root
        # — the agent wrote it untracked, so its HEAD was the base commit and the
        # ff-merge was a no-op. Copy it from the work_dir checkout when missing
        # (idempotent: skipped when git already materialised the committed epic).
        copied = self._materialize_epic_if_missing(node.id, work_dir, epic_dir)

        # pr20-fable-review M2: cli.mjs's real-sha response shape is
        # {merged, sha, output} (index.mjs) — it never carries a
        # `reconcile_status` key, but every reconcile node in every workflow
        # declares `outputs: [reconcile_status]` (8 bindings across
        # bdd/review/tdd/plan/classic/test-swarm) and the noop path above
        # already emits it. Merge it in here too so the real-sha path honors
        # the same declared-output contract; a successful ff-merge is
        # "merged" regardless of the raw cli.mjs payload shape.
        merged_outputs = {**data, "reconcile_status": "merged"}

        return NodeOutput(
            outputs=merged_outputs,
            meta={
                "returncode": result.returncode,
                "stderr": result.stderr,
                "epic_copied": copied,
            },
        )
