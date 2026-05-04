"""Declarative pause/approve gate subsystem.

A `node_type: pause` workflow node SUSPENDS the run, persists a
per-run HMAC signing key (0600), emits a signed resume token, and
waits for an external signal at:

  `<runs_root>/<run_id>/pause/<node_id>.{approve,reject}`

The sentinel file body MUST contain the resume token; `signal.py`
verifies the token's signature against the per-run key BEFORE
honoring the approve/reject. This double-binds the sentinel to the
issued token (defeats both forgery and cross-run replay).
"""

from .errors import (
    PauseError,
    PauseRejectedError,
    PauseSignalForgedError,
    PauseTimeoutError,
    PauseTokenInvalidError,
)
from .signal import SignalKind, SignalResult, wait_for_signal
from .token import (
    DEFAULT_HARD_CEILING_SECONDS,
    Token,
    generate,
    load_or_create_signing_key,
    parse,
    verify,
)

__all__ = [
    "DEFAULT_HARD_CEILING_SECONDS",
    "PauseError",
    "PauseRejectedError",
    "PauseSignalForgedError",
    "PauseTimeoutError",
    "PauseTokenInvalidError",
    "SignalKind",
    "SignalResult",
    "Token",
    "generate",
    "load_or_create_signing_key",
    "parse",
    "verify",
    "wait_for_signal",
]
