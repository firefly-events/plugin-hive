"""hive/lib/question_gateway.py

The headless-question-protocol gateway: envelope read/write, resume-consume,
and renewable-deadline logic described in
hive/references/question-envelope-schema.md.

This module owns ONLY the headless-path mechanics — writing/reading
`.pHive/questions/<skill>-<invocation-id>.yaml` envelopes. The interactive
path (calling AskUserQuestion, or emitting existing prose) is NOT something a
library function can do — AskUserQuestion is a Claude Code runtime tool,
invokable only by the model itself. A calling skill is responsible for:

    from hive.lib.runtime_mode import detect_interactive_mode
    mode = detect_interactive_mode()
    if mode["mode"] == "interactive":
        ... call AskUserQuestion / emit prose exactly as before this protocol ...
    else:
        result = ask_or_emit(skill="kickoff", phase="1a", questions=[...])
        if not result["resolved"]:
            ... print AWAITING_ANSWERS status, exit ...
        else:
            answers = result["answers"]  # {qid: answer}
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from hive.lib.config import DEFAULT_BASELINE_CONFIG_PATH, DEFAULT_PROJECT_CONFIG_PATH, read_config_file

DEFAULT_QUESTIONS_DIR = Path.cwd() / ".pHive" / "questions"

_DEFAULT_ANSWER_DEADLINE_SECONDS = 1800
_DEFAULT_DEADLINE_EXPIRED_ACTION = "re-emit"
_VALID_EXPIRED_ACTIONS = frozenset({"re-emit", "fail"})


class QuestionDeadlineExpiredError(RuntimeError):
    """Raised when an envelope's deadline lapsed with no renewal and
    headless.deadline_expired_action is 'fail'."""

    def __init__(self, skill: str, phase: str, envelope_path: str) -> None:
        super().__init__(
            f"Question envelope for skill={skill!r} phase={phase!r} at "
            f"{envelope_path} expired with no renewal and no answer "
            "(headless.deadline_expired_action=fail)."
        )
        self.skill = skill
        self.phase = phase
        self.envelope_path = envelope_path


@dataclass(frozen=True)
class HeadlessConfig:
    answer_deadline_seconds: int
    deadline_expired_action: str


def resolve_headless_config(
    root_config_path: str | Path | None = None,
    baseline_config_path: str | Path | None = None,
) -> HeadlessConfig:
    """Root-first precedence: root hive.config.yaml -> shipped
    hive/hive.config.yaml baseline -> hardcoded default. No env tier — this
    is an infra tuning knob, not a per-invocation runtime toggle."""
    root_cfg = read_config_file(root_config_path or DEFAULT_PROJECT_CONFIG_PATH)
    baseline_cfg = read_config_file(baseline_config_path or DEFAULT_BASELINE_CONFIG_PATH)

    root_headless = root_cfg.get("headless") if isinstance(root_cfg.get("headless"), dict) else {}
    baseline_headless = (
        baseline_cfg.get("headless") if isinstance(baseline_cfg.get("headless"), dict) else {}
    )

    deadline_seconds = (
        root_headless.get("answer_deadline_seconds")
        if root_headless.get("answer_deadline_seconds") is not None
        else baseline_headless.get("answer_deadline_seconds")
    )
    if deadline_seconds is None:
        deadline_seconds = _DEFAULT_ANSWER_DEADLINE_SECONDS

    expired_action = (
        root_headless.get("deadline_expired_action")
        if root_headless.get("deadline_expired_action") is not None
        else baseline_headless.get("deadline_expired_action")
    )
    if expired_action is None or expired_action not in _VALID_EXPIRED_ACTIONS:
        expired_action = _DEFAULT_DEADLINE_EXPIRED_ACTION

    return HeadlessConfig(
        answer_deadline_seconds=int(deadline_seconds),
        deadline_expired_action=str(expired_action),
    )


def _slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "-", value)


def _now_iso(now: datetime) -> str:
    # Millisecond precision (not truncated to whole seconds) — the invocation
    # id derived from this is the on-disk filename component; whole-second
    # resolution risked two envelope writes for the same skill within the
    # same wall-clock second silently overwriting each other (CodeRabbit
    # review, PR #341).
    return now.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _questions_dir(base_dir: str | Path | None) -> Path:
    return Path(base_dir) if base_dir is not None else DEFAULT_QUESTIONS_DIR


def envelope_path(skill: str, invocation_id: str, base_dir: str | Path | None = None) -> Path:
    return _questions_dir(base_dir) / f"{_slug(skill)}-{_slug(invocation_id)}.yaml"


def _write_yaml(path: Path, data: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        import yaml  # type: ignore

        path.write_text(yaml.safe_dump(dict(data), sort_keys=False), encoding="utf-8")
    except Exception:
        import json

        path.write_text(json.dumps(dict(data), indent=2, default=str), encoding="utf-8")


def _read_yaml(path: Path) -> dict[str, Any] | None:
    """Returns None only when the file is absent. Raises ValueError when the
    file exists but cannot be parsed into a mapping — a malformed envelope
    must never be silently treated as "no envelope" (CodeRabbit review, PR
    #341): that conflation would let a caller write a duplicate envelope over
    a corrupted one instead of surfacing the corruption."""
    if not path.exists():
        return None
    raw = path.read_text(encoding="utf-8")
    loaded: Any = None
    parse_error: Exception | None = None
    try:
        import yaml  # type: ignore

        loaded = yaml.safe_load(raw)
    except Exception as exc:
        parse_error = exc
        try:
            import json

            loaded = json.loads(raw)
            parse_error = None
        except Exception as json_exc:
            parse_error = json_exc
    if parse_error is not None:
        raise ValueError(f"Envelope at {path} exists but could not be parsed as YAML or JSON: {parse_error}")
    if not isinstance(loaded, dict):
        raise ValueError(f"Envelope at {path} exists but did not parse to a mapping (got {type(loaded).__name__})")
    return loaded


def write_envelope(
    skill: str,
    phase: str,
    questions: list[dict[str, Any]],
    base_dir: str | Path | None = None,
    deadline_seconds: int | None = None,
    now: datetime | None = None,
) -> tuple[dict[str, Any], Path]:
    now = now or datetime.now(timezone.utc)
    deadline_seconds = (
        deadline_seconds if deadline_seconds is not None else resolve_headless_config().answer_deadline_seconds
    )
    invocation_id = _now_iso(now).replace(":", "-")
    path = envelope_path(skill, invocation_id, base_dir)

    envelope: dict[str, Any] = {
        "id": f"{skill}-{invocation_id}",
        "skill": skill,
        "phase": phase,
        "status": "pending",
        "provenance": {"raised_by": skill, "raised_at": _now_iso(now)},
        "deadline": _now_iso(now + timedelta(seconds=deadline_seconds)),
        "renewal_count": 0,
        "questions": [
            {
                "qid": q["qid"],
                "text": q["text"],
                "kind": q.get("kind", "single-select"),
                "options": q.get("options"),
                "required": q.get("required", True),
                "answer": None,
            }
            for q in questions
        ],
    }
    _write_yaml(path, envelope)
    return envelope, path


def find_envelope_for_phase(
    skill: str, phase: str, base_dir: str | Path | None = None
) -> tuple[dict[str, Any], Path] | None:
    base = _questions_dir(base_dir)
    if not base.exists():
        return None
    candidates = sorted(base.glob(f"{skill}-*.yaml"))
    for path in reversed(candidates):
        env = _read_yaml(path)
        if env and env.get("phase") == phase:
            return env, path
    return None


def renew_envelope(
    path: str | Path, extra_seconds: int, now: datetime | None = None
) -> dict[str, Any]:
    """Orchestrator-side operation: extend a still-pending envelope's
    deadline without answering, incrementing renewal_count. Raises if the
    envelope is missing or already answered."""
    now = now or datetime.now(timezone.utc)
    path = Path(path)
    env = _read_yaml(path)
    if env is None:
        raise FileNotFoundError(f"No envelope at {path}")
    if env.get("status") == "answered":
        raise ValueError(f"Cannot renew an already-answered envelope at {path}")
    env["deadline"] = _now_iso(now + timedelta(seconds=extra_seconds))
    env["renewal_count"] = int(env.get("renewal_count", 0)) + 1
    _write_yaml(path, env)
    return env


def _extract_answers(envelope: Mapping[str, Any]) -> dict[str, Any] | None:
    """Closure invariant: status must be 'answered' AND every required
    question must have a non-null answer. Returns None (treat as still
    pending) if the invariant isn't satisfied, even if status says
    'answered' — defends against an orchestrator flipping status
    prematurely."""
    if envelope.get("status") != "answered":
        return None
    answers: dict[str, Any] = {}
    for q in envelope.get("questions", []):
        answer = q.get("answer")
        if q.get("required", True) and answer is None:
            return None
        answers[q["qid"]] = answer
    return answers


def ask_or_emit(
    skill: str,
    phase: str,
    questions: list[dict[str, Any]],
    base_dir: str | Path | None = None,
    now: datetime | None = None,
    config: HeadlessConfig | None = None,
) -> dict[str, Any]:
    """Headless-path entry point. Returns either:
      {"resolved": True, "answers": {qid: answer, ...}}
    or:
      {"resolved": False, "status": "pending", "envelope_path": str, "deadline": iso}
    Raises QuestionDeadlineExpiredError if the matched envelope's deadline
    lapsed with no renewal and headless.deadline_expired_action == 'fail'.
    """
    now = now or datetime.now(timezone.utc)
    cfg = config or resolve_headless_config()

    existing = find_envelope_for_phase(skill, phase, base_dir)
    if existing is not None:
        env, path = existing
        answers = _extract_answers(env)
        if answers is not None:
            return {"resolved": True, "answers": answers}

        deadline = _parse_iso(env["deadline"])
        if now < deadline:
            return {
                "resolved": False,
                "status": "pending",
                "envelope_path": str(path),
                "deadline": env["deadline"],
            }

        # Expired, no renewal.
        if cfg.deadline_expired_action == "fail":
            raise QuestionDeadlineExpiredError(skill, phase, str(path))
        # re-emit: fall through to write a fresh envelope below.

    env, path = write_envelope(
        skill, phase, questions, base_dir=base_dir, deadline_seconds=cfg.answer_deadline_seconds, now=now
    )
    return {
        "resolved": False,
        "status": "pending",
        "envelope_path": str(path),
        "deadline": env["deadline"],
    }
