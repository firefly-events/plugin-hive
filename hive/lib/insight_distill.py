"""Write side of the multica agent learning loop (s2-insight-distill-harvest).

Harvests an agent's self-capture (`.hive/insights/{story}.md`) plus a bounded
transcript excerpt and git diff, and distills them at capture time — curated
from the start, never deferred — via a `claude --print` one-shot. The curated
result is written as a committed team-memory under
`.pHive/team-memories/{persona}/{story}.md`, keyed by the persona stamped on
dispatch (s1-brief-memory-injection), and durable learnings are emitted as KG
triples via `kg_emit`.

Stdlib-only (language-strategy-adr.md, Option B). The Node episode writers
(`hive/lib/multica-story-dispatch/episode-sync.mjs`) invoke this module as a
subprocess and pass paths only — no distillation logic belongs there.

A failed or unavailable `claude --print` degrades gracefully: the raw
self-capture is copied through as the team-memory body instead of a curated
one. A failed distill must never be a failed episode — this module never
raises for expected failure modes; it reports them in the JSON result.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from hive.lib.kg_emit import emit_kg_event, sanitize_obj

DEFAULT_CLAUDE_BIN = "claude"
DEFAULT_TIMEOUT_MS = 60_000
DEFAULT_DIFF_MAX_BYTES = 20_000
DEFAULT_TRANSCRIPT_MAX_BYTES = 40_000
DEFAULT_SELF_CAPTURE_MAX_BYTES = 40_000
DEFAULT_TTL_DAYS = 90
KG_PREDICATE = "insight"  # settled in S3: durable learnings use a dedicated predicate,
# distinct from `decided` (a deliberate architectural/implementation choice by an
# actor). See hive/references/knowledge-graph-schema.md.


def _read_bounded(path: Path | None, max_bytes: int) -> str:
    if not path:
        return ""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    return raw[:max_bytes] if len(raw) > max_bytes else raw


def _read_git_diff(work_dir: str | None, max_bytes: int) -> str:
    if not work_dir:
        return ""
    try:
        result = subprocess.run(
            ["git", "-C", work_dir, "diff", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if result.returncode != 0:
        return ""
    stdout = result.stdout
    return stdout[:max_bytes] if len(stdout) > max_bytes else stdout


def has_signal(*values: str) -> bool:
    return any(v.strip() for v in values)


def default_self_capture_path(work_dir: str | None, story: str) -> Path | None:
    if not work_dir:
        return None
    return Path(work_dir) / ".hive" / "insights" / f"{story}.md"


def build_prompt(*, self_capture: str, transcript: str, git_diff: str, persona: str,
                  epic: str, story: str) -> str:
    parts = [
        f"# Insight distillation for persona: {persona}",
        f"epic: {epic}  story: {story}",
        "You are curating a durable team memory from one agent's completed work.",
        "Dedupe, generalize, and score the inputs below — keep only what a future "
        "agent working on a DIFFERENT story could act on without re-investigating. "
        "Discard routine completions and anything specific to this run only.",
    ]
    if self_capture:
        parts.append(f"## Agent self-capture\n{self_capture}")
    if transcript:
        parts.append(f"## Transcript excerpt (JSONL)\n{transcript}")
    if git_diff:
        parts.append(f"## Git diff\n{git_diff}")
    parts.append(
        "## Output format\n"
        "Respond with ONLY a JSON object (no prose, no code fences) shaped as:\n"
        '{"memory": {"name": "short-kebab-slug", "description": "one-line summary", '
        '"type": "pattern|pitfall|override|codebase|reference", "body": "markdown body"}, '
        '"learnings": ["short durable learning statement", ...]}\n'
        "If nothing durable or reusable survives curation, respond with "
        '{"memory": null, "learnings": []}.'
    )
    return "\n\n".join(parts)


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


def invoke_claude(prompt: str, *, claude_bin: str, timeout_ms: int) -> dict[str, Any]:
    result = subprocess.run(
        [claude_bin, "--print"],
        input=prompt,
        text=True,
        capture_output=True,
        timeout=timeout_ms / 1000.0,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{claude_bin} --print exited {result.returncode}: {result.stderr.strip()}")
    parsed = json.loads(_strip_code_fence(result.stdout))
    if not isinstance(parsed, dict):
        raise ValueError("claude --print did not return a JSON object")
    return parsed


def memory_frontmatter(*, name: str, description: str, memory_type: str, persona: str,
                        epic: str, ttl_days: int | None, source: str) -> str:
    lines = [
        "---",
        f"name: {name}",
        f"description: {json.dumps(description)}",
        f"type: {memory_type}",
        f"agent: {persona}",
        f"source_epic: {epic}",
        f"ttl_days: {ttl_days if ttl_days is not None else 'null'}",
        f"source: {source}",
        "---",
        "",
    ]
    return "\n".join(lines)


def _stage_team_memory(file_path: Path) -> None:
    """`git add` the written team-memory file (S2-AC2: staged for commit).

    Best-effort: staging is a courtesy to the caller's eventual commit, not a
    correctness requirement of the harvest — a repo-less team_memories_root
    (e.g. an isolated test tmpdir) or any git failure must never fail distill.
    """
    try:
        subprocess.run(
            ["git", "-C", str(file_path.parent), "add", file_path.name],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        pass


def write_team_memory(*, team_memories_root: Path, persona: str, story: str, content: str) -> str:
    persona_dir = team_memories_root / persona
    persona_dir.mkdir(parents=True, exist_ok=True)
    file_path = persona_dir / f"{story}.md"
    file_path.write_text(content, encoding="utf-8")
    _stage_team_memory(file_path)
    return str(file_path)


def distill(*, epic: str, story: str, persona: str, work_dir: str | None,
            self_capture_path: Path | None, transcript_path: Path | None,
            team_memories_root: Path, claude_bin: str = DEFAULT_CLAUDE_BIN,
            timeout_ms: int = DEFAULT_TIMEOUT_MS,
            diff_max_bytes: int = DEFAULT_DIFF_MAX_BYTES,
            transcript_max_bytes: int = DEFAULT_TRANSCRIPT_MAX_BYTES,
            self_capture_max_bytes: int = DEFAULT_SELF_CAPTURE_MAX_BYTES) -> dict[str, Any]:
    if not persona:
        return {"skipped": True, "reason": "missing-persona", "written": None,
                "kg_emitted": 0, "degraded": False, "error": None}

    self_capture = _read_bounded(self_capture_path, self_capture_max_bytes)
    transcript = _read_bounded(transcript_path, transcript_max_bytes)
    git_diff = _read_git_diff(work_dir, diff_max_bytes)

    if not has_signal(self_capture, transcript, git_diff):
        return {"skipped": True, "reason": "no-capture", "written": None,
                "kg_emitted": 0, "degraded": False, "error": None}

    try:
        prompt = build_prompt(
            self_capture=self_capture, transcript=transcript, git_diff=git_diff,
            persona=persona, epic=epic, story=story,
        )
        response = invoke_claude(prompt, claude_bin=claude_bin, timeout_ms=timeout_ms)
        memory = response.get("memory")
        learnings = [str(item) for item in response.get("learnings") or [] if str(item).strip()]

        if not memory:
            return {"skipped": True, "reason": "nothing-durable", "written": None,
                    "kg_emitted": 0, "degraded": False, "error": None}

        frontmatter = memory_frontmatter(
            name=str(memory.get("name") or story),
            description=str(memory.get("description") or ""),
            memory_type=str(memory.get("type") or "pattern"),
            persona=persona,
            epic=epic,
            ttl_days=DEFAULT_TTL_DAYS,
            source="distilled",
        )
        body = str(memory.get("body") or "").strip()
        content = f"{frontmatter}{body}\n"
        written = write_team_memory(
            team_memories_root=team_memories_root, persona=persona, story=story, content=content,
        )

        kg_emitted = 0
        subject = f"{epic}:{story}"
        for learning in learnings:
            outcome = emit_kg_event(
                subject=subject,
                predicate=KG_PREDICATE,
                obj=sanitize_obj(learning),
                source_epic=epic,
                source_agent=persona,
            )
            if outcome.get("emitted"):
                kg_emitted += 1

        return {"skipped": False, "written": written, "kg_emitted": kg_emitted,
                "degraded": False, "error": None}
    except Exception as exc:  # noqa: BLE001 - degrade, never fail the episode
        if not self_capture.strip():
            return {"skipped": True, "reason": "distill-failed-no-raw-capture", "written": None,
                    "kg_emitted": 0, "degraded": False, "error": str(exc)}
        frontmatter = memory_frontmatter(
            name=story,
            description="Raw self-capture (distillation unavailable)",
            memory_type="reference",
            persona=persona,
            epic=epic,
            ttl_days=DEFAULT_TTL_DAYS,
            source="agent-raw",
        )
        written = write_team_memory(
            team_memories_root=team_memories_root, persona=persona, story=story,
            content=f"{frontmatter}{self_capture.strip()}\n",
        )
        return {"skipped": False, "written": written, "kg_emitted": 0,
                "degraded": True, "error": str(exc)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Harvest + distill a multica story's insights.")
    parser.add_argument("--epic", required=True)
    parser.add_argument("--story", required=True)
    parser.add_argument("--persona", default=None)
    parser.add_argument("--work-dir", default=None)
    parser.add_argument("--self-capture", default=None)
    parser.add_argument("--transcript", default=None)
    parser.add_argument("--state-dir", default=".pHive")
    parser.add_argument("--team-memories-root", default=None)
    parser.add_argument("--claude-bin", default=DEFAULT_CLAUDE_BIN)
    parser.add_argument("--timeout-ms", type=int, default=DEFAULT_TIMEOUT_MS)
    parser.add_argument("--diff-max-bytes", type=int, default=DEFAULT_DIFF_MAX_BYTES)
    parser.add_argument("--transcript-max-bytes", type=int, default=DEFAULT_TRANSCRIPT_MAX_BYTES)
    parser.add_argument("--self-capture-max-bytes", type=int, default=DEFAULT_SELF_CAPTURE_MAX_BYTES)
    args = parser.parse_args(argv)

    self_capture_path = (
        Path(args.self_capture) if args.self_capture
        else default_self_capture_path(args.work_dir, args.story)
    )
    transcript_path = Path(args.transcript) if args.transcript else None
    team_memories_root = (
        Path(args.team_memories_root) if args.team_memories_root
        else Path(args.state_dir) / "team-memories"
    )

    result = distill(
        epic=args.epic,
        story=args.story,
        persona=args.persona,
        work_dir=args.work_dir,
        self_capture_path=self_capture_path,
        transcript_path=transcript_path,
        team_memories_root=team_memories_root,
        claude_bin=args.claude_bin,
        timeout_ms=args.timeout_ms,
        diff_max_bytes=args.diff_max_bytes,
        transcript_max_bytes=args.transcript_max_bytes,
        self_capture_max_bytes=args.self_capture_max_bytes,
    )
    sys.stdout.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
