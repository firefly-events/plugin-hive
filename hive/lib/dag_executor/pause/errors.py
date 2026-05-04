"""Typed exceptions for the pause subsystem."""

from __future__ import annotations


class PauseError(Exception):
    """Base for every pause failure."""


class PauseTokenInvalidError(PauseError):
    """Token failed signature verification or was for the wrong run/node.

    Tokens are bound to BOTH `run_id` AND `node_id` (Risk #10). A
    token from run-A cannot resume run-B; a token from node-X within
    run-A cannot resume node-Y within the same run.
    """


class PauseRejectedError(PauseError):
    """Operator wrote a `.reject` sentinel (or signal returned REJECTED)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class PauseTimeoutError(PauseError):
    """Pause timed out without an approve/reject signal.

    Both the user-configured timeout AND the security hard-ceiling
    default trigger this error.
    """


class PauseSignalForgedError(PauseError):
    """Sentinel file present but its body did not carry a valid token.

    Security:plan-audit finding #2 mitigation — sentinel filenames
    alone never approve a pause; the body must contain the issued
    resume token.
    """
