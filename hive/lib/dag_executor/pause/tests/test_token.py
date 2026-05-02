"""HMAC-signed pause tokens — generate / verify / tamper."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from hive.lib.dag_executor.executor.run_id import make_run_id
from hive.lib.dag_executor.pause import (
    PauseTokenInvalidError,
    generate,
    load_or_create_signing_key,
    parse,
    verify,
)


@pytest.fixture
def runs_root(tmp_path: Path) -> Path:
    return tmp_path / "runs"


@pytest.fixture(autouse=True)
def _clear_env_secret(monkeypatch):
    monkeypatch.delenv("HIVE_PAUSE_SECRET", raising=False)


def test_generate_then_verify_round_trip(runs_root: Path):
    rid = make_run_id("pause-test")
    token = generate(rid, "human_approval", runs_root)
    parsed = verify(token, rid, "human_approval", runs_root)
    assert parsed.run_id == rid
    assert parsed.node_id == "human_approval"


def test_signing_key_file_mode_is_0600(runs_root: Path):
    rid = make_run_id("pause-test")
    generate(rid, "human_approval", runs_root)
    key_path = runs_root / rid / ".signing_key"
    assert key_path.exists()
    mode = os.stat(key_path).st_mode & 0o777
    assert mode == 0o600, f"signing key file mode must be 0600, got {oct(mode)}"


def test_signing_key_directory_is_0700(runs_root: Path):
    rid = make_run_id("pause-test")
    generate(rid, "human_approval", runs_root)
    dir_path = runs_root / rid
    mode = os.stat(dir_path).st_mode & 0o777
    assert mode == 0o700, f"per-run dir mode must be 0700, got {oct(mode)}"


def test_two_runs_have_different_signing_keys(runs_root: Path):
    rid_a = make_run_id("pause-test")
    rid_b = make_run_id("pause-test")
    key_a = load_or_create_signing_key(rid_a, runs_root)
    key_b = load_or_create_signing_key(rid_b, runs_root)
    assert key_a != key_b


def test_signing_key_file_never_logged_or_serialised(runs_root: Path):
    """The signing key bytes never round-trip through any serialisable
    intermediate. Token format does NOT include the key."""

    rid = make_run_id("pause-test")
    token = generate(rid, "human_approval", runs_root)
    parsed = parse(token)
    # Token has no field that could carry the key.
    assert "key" not in parsed.__dict__
    assert "secret" not in parsed.__dict__


# ---------------------------------------------------------------------
# Tamper rejection (Risk #10 — cross-run / cross-node replay)
# ---------------------------------------------------------------------


def test_verify_rejects_token_for_wrong_node_id(runs_root: Path):
    rid = make_run_id("pause-test")
    token = generate(rid, "human_approval", runs_root)
    with pytest.raises(PauseTokenInvalidError):
        verify(token, rid, "different_node", runs_root)


def test_verify_rejects_token_for_wrong_run_id(runs_root: Path):
    rid_a = make_run_id("pause-test")
    rid_b = make_run_id("pause-test")
    token = generate(rid_a, "human_approval", runs_root)
    with pytest.raises(PauseTokenInvalidError):
        verify(token, rid_b, "human_approval", runs_root)


def test_verify_rejects_tampered_signature(runs_root: Path):
    rid = make_run_id("pause-test")
    token = generate(rid, "human_approval", runs_root)
    payload, sig = token.rsplit(".", 1)
    # Flip one byte of the hex signature.
    tampered_sig = ("a" if sig[0] != "a" else "b") + sig[1:]
    tampered_token = f"{payload}.{tampered_sig}"
    with pytest.raises(PauseTokenInvalidError):
        verify(tampered_token, rid, "human_approval", runs_root)


def test_parse_rejects_malformed_token(runs_root: Path):
    with pytest.raises(PauseTokenInvalidError):
        parse("no-separator-here")
    with pytest.raises(PauseTokenInvalidError):
        parse("bad.short")
    with pytest.raises(PauseTokenInvalidError):
        parse("@@@.0123456789012345678901234567890123456789012345678901234567890123")


# ---------------------------------------------------------------------
# Env-secret override (test/CI only)
# ---------------------------------------------------------------------


def test_env_secret_overrides_per_run_key(runs_root: Path, monkeypatch):
    monkeypatch.setenv("HIVE_PAUSE_SECRET", "shared-secret-for-tests")
    rid_a = make_run_id("pause-test")
    rid_b = make_run_id("pause-test")
    key_a = load_or_create_signing_key(rid_a, runs_root)
    key_b = load_or_create_signing_key(rid_b, runs_root)
    assert key_a == key_b == b"shared-secret-for-tests"
