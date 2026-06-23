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
import shutil
import subprocess
from pathlib import Path
from typing import Any

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
    ) -> None:
        self._cli_path = Path(cli_path) if cli_path else self._default_cli_path()
        self._node_bin = node_bin
        # The merge TARGET: the executor's repo_root (the project tree the
        # downstream gate validates). The agent's work_dir is only the fetch
        # SOURCE. See handle() / #8.
        self._repo_root = Path(repo_root).resolve() if repo_root is not None else None
        self._timeout_ms = timeout_ms

    @staticmethod
    def _default_cli_path() -> Path:
        # reconcile.py is at hive/lib/dag_executor/executor/handlers/reconcile.py
        # cli.mjs  is at hive/lib/multica-story-dispatch/cli.mjs
        here = Path(__file__).resolve().parent
        return (here / "../../../multica-story-dispatch/cli.mjs").resolve()

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
                outputs={}, meta={"reconcile": "noop", "epic_copied": copied}
            )

        if not branch:
            raise ReconcileHandlerError(
                f"reconcile node {node.id!r}: 'branch' input required when sha is set"
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

        return NodeOutput(
            outputs=data,
            meta={
                "returncode": result.returncode,
                "stderr": result.stderr,
                "epic_copied": copied,
            },
        )
