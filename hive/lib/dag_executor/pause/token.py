"""HMAC-SHA256 resume tokens for declarative pause nodes.

Per the locked design (security:plan-audit findings #1 + #2 + #4):

  * The signing key is a per-run secret stored at
    `<runs_root>/<run_id>/.signing_key` with mode 0600. Generated on
    first pause (constant-time random); never logged, never leaves
    the machine. `HIVE_PAUSE_SECRET` env var overrides for tests
    only.
  * Tokens bind BOTH `run_id` AND `node_id` (Risk #10). A token from
    run-A cannot resume run-B; a token from node-X within run-A
    cannot resume node-Y within the same run.
  * The default hard-ceiling timeout is 30 days (per finding #3).
    A user-configured "no timeout" reads as None; the security floor
    still applies.

Token wire format: `<base64(payload_json)>.<hex_signature>` — single
period separator, both halves URL-safe so the token can be embedded
in sentinel files or logs without escaping.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .errors import PauseTokenInvalidError


# Security-floor default: a "no timeout" pause still terminates after
# 30 days. Distinct from the UX default (None = wait indefinitely) —
# the hard-ceiling kicks in when the user-configured timeout is None.
DEFAULT_HARD_CEILING_SECONDS: int = 30 * 24 * 60 * 60


_SIGNING_KEY_FILENAME = ".signing_key"
_HMAC_DIGEST_HEX_LEN = 64  # sha256 → 32 bytes → 64 hex chars
_KEY_BYTES = 32  # 256 bits


@dataclass
class Token:
    run_id: str
    node_id: str
    timestamp: str
    signature: str


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _signing_key_path(run_id: str, runs_root: Path) -> Path:
    return runs_root / run_id / _SIGNING_KEY_FILENAME


def load_or_create_signing_key(run_id: str, runs_root: Path) -> bytes:
    """Read the per-run signing key; create it on first call.

    Mode 0600 is enforced on the file; parent directory is created
    with mode 0700 if missing. The key never leaves this function in
    serialised form — callers receive the raw bytes and pass them
    straight into hmac.
    """

    env_secret = os.environ.get("HIVE_PAUSE_SECRET")
    if env_secret:
        # Test/CI override only. Documented in token.py module
        # docstring; not the production path.
        return env_secret.encode("utf-8")

    key_path = _signing_key_path(run_id, runs_root)
    if key_path.exists():
        return key_path.read_bytes()
    parent = key_path.parent
    parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(parent, 0o700)
    except OSError:
        pass
    fd = os.open(str(key_path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        key = secrets.token_bytes(_KEY_BYTES)
        os.write(fd, key)
    finally:
        os.close(fd)
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass
    return key


def _payload_bytes(run_id: str, node_id: str, timestamp: str) -> bytes:
    payload = {"run_id": run_id, "node_id": node_id, "timestamp": timestamp}
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _sign(payload: bytes, key: bytes) -> str:
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def generate(
    run_id: str,
    node_id: str,
    runs_root: Path,
    timestamp: str | None = None,
) -> str:
    """Build, sign, and encode a resume token for `(run_id, node_id)`."""

    ts = timestamp or _now_iso()
    payload = _payload_bytes(run_id, node_id, ts)
    key = load_or_create_signing_key(run_id, runs_root)
    sig = _sign(payload, key)
    encoded_payload = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return f"{encoded_payload}.{sig}"


def parse(token: str) -> Token:
    """Decode without verifying; useful for inspection / debug."""

    if "." not in token:
        raise PauseTokenInvalidError(f"malformed token (no separator): {token!r}")
    encoded_payload, sig = token.rsplit(".", 1)
    if len(sig) != _HMAC_DIGEST_HEX_LEN:
        raise PauseTokenInvalidError("malformed token (signature length wrong)")
    padding = "=" * (-len(encoded_payload) % 4)
    try:
        payload_bytes = base64.urlsafe_b64decode(encoded_payload + padding)
    except (binascii.Error, ValueError) as exc:
        raise PauseTokenInvalidError(f"malformed token (base64 decode): {exc}") from exc
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PauseTokenInvalidError(f"malformed token (json decode): {exc}") from exc
    return Token(
        run_id=payload.get("run_id", ""),
        node_id=payload.get("node_id", ""),
        timestamp=payload.get("timestamp", ""),
        signature=sig,
    )


def verify(
    token: str,
    expected_run_id: str,
    expected_node_id: str,
    runs_root: Path,
) -> Token:
    """Decode, recompute signature, raise on mismatch.

    Risk #10: rejects tokens whose embedded `run_id` / `node_id`
    differ from the expected pair, even if the signature would
    otherwise match a different (run_id, node_id) pair.
    """

    parsed = parse(token)
    if parsed.run_id != expected_run_id:
        raise PauseTokenInvalidError(
            f"token run_id mismatch: token={parsed.run_id!r} expected={expected_run_id!r}"
        )
    if parsed.node_id != expected_node_id:
        raise PauseTokenInvalidError(
            f"token node_id mismatch: token={parsed.node_id!r} expected={expected_node_id!r}"
        )
    payload = _payload_bytes(parsed.run_id, parsed.node_id, parsed.timestamp)
    key = load_or_create_signing_key(expected_run_id, runs_root)
    expected_sig = _sign(payload, key)
    if not hmac.compare_digest(parsed.signature, expected_sig):
        raise PauseTokenInvalidError("token signature does not match")
    return parsed
