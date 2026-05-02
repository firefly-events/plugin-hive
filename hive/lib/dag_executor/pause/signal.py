"""External-signal contract for pause nodes.

Sentinel files live at:

  `<runs_root>/<run_id>/pause/<node_id>.approve`
  `<runs_root>/<run_id>/pause/<node_id>.reject`

Per security:plan-audit findings #2 + #3:

  * Sentinel directory is created with mode 0700.
  * Sentinel filename alone NEVER honors the pause — the file body
    must contain the resume token issued by `token.generate(...)`.
    `signal.py` reads the body and runs `token.verify(...)`; an
    invalid token raises `PauseSignalForgedError` and the loop keeps
    polling (it does NOT abort with success).
  * Reject sentinel may carry an optional reason on a line after the
    token (separator: blank line). The token-only sentinel is treated
    as a reason-less reject.
  * Hard-ceiling timeout default of 30 days applies even when the
    user-configured timeout is None — the security floor.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

from .errors import (
    PauseSignalForgedError,
    PauseTimeoutError,
    PauseTokenInvalidError,
)
from .token import DEFAULT_HARD_CEILING_SECONDS, verify


class SignalKind(str, Enum):
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass
class SignalResult:
    kind: SignalKind
    reason: str | None
    sentinel_path: Path


def _ensure_pause_dir(run_id: str, runs_root: Path) -> Path:
    base = runs_root / run_id / "pause"
    base.mkdir(parents=True, exist_ok=True)
    try:
        import os

        os.chmod(base, 0o700)
    except OSError:
        pass
    return base


def _read_sentinel_token_and_reason(path: Path) -> tuple[str, str | None]:
    """Sentinel format: line 1 = token; remainder (after blank line) = reason."""

    text = path.read_text(encoding="utf-8")
    parts = text.split("\n\n", 1)
    token = parts[0].strip()
    reason = parts[1].strip() if len(parts) == 2 and parts[1].strip() else None
    return token, reason


def wait_for_signal(
    run_id: str,
    node_id: str,
    runs_root: Path,
    timeout_seconds: int | None = None,
    poll_interval: float = 5.0,
    hard_ceiling_seconds: int = DEFAULT_HARD_CEILING_SECONDS,
    clock: callable = time.time,
    sleep: callable = time.sleep,
) -> SignalResult:
    """Poll for an approve/reject sentinel and return the verified outcome.

    Verification:
      * Sentinel file body must contain the resume token issued by
        `token.generate(run_id, node_id, runs_root)`.
      * The token's signature must match the per-run signing key.
      * The token's embedded `run_id` / `node_id` must equal the
        expected pair (cross-run replay defense).

    Timeout:
      * `timeout_seconds=None` → wait up to `hard_ceiling_seconds`
        (security floor; default 30 days).
      * `timeout_seconds=N` → wait up to `min(N, hard_ceiling_seconds)`.
    """

    base = _ensure_pause_dir(run_id, runs_root)
    approve_path = base / f"{node_id}.approve"
    reject_path = base / f"{node_id}.reject"

    effective_timeout = (
        min(timeout_seconds, hard_ceiling_seconds)
        if timeout_seconds is not None
        else hard_ceiling_seconds
    )
    started = clock()

    while True:
        if approve_path.exists():
            token_str, _ = _read_sentinel_token_and_reason(approve_path)
            try:
                verify(token_str, run_id, node_id, runs_root)
            except PauseTokenInvalidError as exc:
                raise PauseSignalForgedError(
                    f"approve sentinel at {approve_path} carries invalid token: {exc}"
                ) from exc
            return SignalResult(kind=SignalKind.APPROVED, reason=None, sentinel_path=approve_path)

        if reject_path.exists():
            token_str, reason = _read_sentinel_token_and_reason(reject_path)
            try:
                verify(token_str, run_id, node_id, runs_root)
            except PauseTokenInvalidError as exc:
                raise PauseSignalForgedError(
                    f"reject sentinel at {reject_path} carries invalid token: {exc}"
                ) from exc
            return SignalResult(kind=SignalKind.REJECTED, reason=reason, sentinel_path=reject_path)

        if clock() - started > effective_timeout:
            raise PauseTimeoutError(
                f"pause for {run_id!r}/{node_id!r} timed out after {effective_timeout}s "
                f"(user_timeout={timeout_seconds}, hard_ceiling={hard_ceiling_seconds})"
            )
        sleep(poll_interval)
